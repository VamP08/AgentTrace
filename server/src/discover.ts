// Find sessions and their subagents without parsing whole files. Sessions come from two places:
// the coding tool's own projects folder, and AgentTrace's archive of sessions it has indexed.
// The live copy wins while it exists; the archive answers once the tool has cleaned up.
// Title, cwd and start time come from the first and last 64KB of each transcript.
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentInfo, Session } from '@agenttrace/shared';
import { archiveRoot, livePaths } from './archive.js';

const LIVE_WINDOW_MS = 30_000;
const PEEK_BYTES = 64 * 1024;

export function discoverSessions(claudeRoot: string): Session[] {
  const byId = new Map<string, Session>();
  const scan = (root: string, archived: boolean) => {
    const projectsDir = join(root, 'projects');
    if (!existsSync(projectsDir)) return;
    for (const slug of readdirSync(projectsDir)) {
      const dir = join(projectsDir, slug);
      let entries: string[];
      try {
        if (!statSync(dir).isDirectory()) continue;
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const id = basename(name, '.jsonl');
        if (archived && byId.has(id)) continue; // the live copy is already listed
        try {
          byId.set(id, describeSession(slug, archived, livePaths(root, slug, id)));
        } catch {
          // unreadable file: skip rather than fail the whole list
        }
      }
    }
  };
  scan(claudeRoot, false);
  scan(archiveRoot(claudeRoot), true);
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function findSession(claudeRoot: string, id: string): Session | undefined {
  return discoverSessions(claudeRoot).find((s) => s.id === id);
}

function describeSession(projectSlug: string, archived: boolean, paths: { file: string; dir: string; fileHistory: string }): Session {
  const { file } = paths;
  const st = statSync(file);
  const head = peek(file, 0, Math.min(PEEK_BYTES, st.size));
  const tail = st.size > PEEK_BYTES ? peek(file, st.size - PEEK_BYTES, PEEK_BYTES) : head;
  const id = basename(file, '.jsonl');
  return {
    id,
    projectSlug,
    cwd: firstMatch(head, /"cwd":"((?:[^"\\]|\\.)*)"/) ?? '',
    title: title(tail, head),
    startedAt: firstMatch(head, /"timestamp":"([^"]+)"/) ?? st.birthtime.toISOString(),
    updatedAt: st.mtime.toISOString(),
    bytes: st.size,
    live: !archived && Date.now() - st.mtimeMs < LIVE_WINDOW_MS,
    archived,
    ...paths,
  };
}

function title(tail: string, head: string): string {
  return (
    lastMatch(tail, /"customTitle":"((?:[^"\\]|\\.)*)"/) ??
    lastMatch(tail, /"aiTitle":"((?:[^"\\]|\\.)*)"/) ??
    lastMatch(head, /"aiTitle":"((?:[^"\\]|\\.)*)"/) ??
    firstUserText(head) ??
    '(untitled)'
  );
}

function firstUserText(head: string): string | undefined {
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    try {
      const rec = JSON.parse(line);
      const c = rec.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((b: any) => b?.type === 'text')?.text : undefined;
      // system-injected caveats and command wrappers start with a tag; a person's prompt does not
      if (typeof text === 'string' && text.trim() && !text.trim().startsWith('<')) {
        const t = text.trim();
        return t.length > 120 ? `${t.slice(0, 119)}…` : t;
      }
    } catch {
      // partial line at the 64KB boundary
    }
  }
  return undefined;
}

/** Subagent transcripts under a session's folder, joined to their meta files. */
export function discoverAgents(sessionDir: string): AgentInfo[] {
  const out: AgentInfo[] = [];
  const scan = (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        scan(full, `${rel}/${name}`);
        continue;
      }
      const m = /^agent-([0-9a-f]+)\.jsonl$/.exec(name);
      if (!m) continue;
      const metaFile = join(dir, `agent-${m[1]}.meta.json`);
      let meta: any = {};
      try {
        meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      } catch {
        // meta missing on old sessions; the transcript still counts
      }
      out.push({
        agentId: m[1],
        agentType: String(meta.agentType ?? 'unknown'),
        description: String(meta.description ?? ''),
        toolUseId: String(meta.toolUseId ?? ''),
        spawnDepth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : 1,
        file: `${rel}/${name}`.replace(/^\//, ''),
      });
    }
  };
  scan(join(sessionDir, 'subagents'), 'subagents');
  return out;
}

function peek(file: string, position: number, length: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, position);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

function firstMatch(s: string, re: RegExp): string | undefined {
  const m = re.exec(s);
  return m ? unescape(m[1]) : undefined;
}

function lastMatch(s: string, re: RegExp): string | undefined {
  let last: string | undefined;
  for (const m of s.matchAll(new RegExp(re.source, 'g'))) last = m[1];
  return last === undefined ? undefined : unescape(last);
}

function unescape(jsonString: string): string {
  try {
    return JSON.parse(`"${jsonString}"`);
  } catch {
    return jsonString;
  }
}
