// Find sessions and their subagents under <claudeRoot>/projects without parsing whole files.
// Title, cwd and start time come from the first and last 64KB of each transcript.
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentInfo, Session } from '@agenttrace/shared';

const LIVE_WINDOW_MS = 30_000;
const PEEK_BYTES = 64 * 1024;

export function discoverSessions(claudeRoot: string): Session[] {
  const projectsDir = join(claudeRoot, 'projects');
  if (!existsSync(projectsDir)) return [];
  const out: Session[] = [];
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
      const file = join(dir, name);
      try {
        out.push(describeSession(file, slug));
      } catch {
        // unreadable file: skip rather than fail the whole list
      }
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function sessionFile(claudeRoot: string, projectSlug: string, id: string): string {
  return join(claudeRoot, 'projects', projectSlug, `${id}.jsonl`);
}

function describeSession(file: string, projectSlug: string): Session {
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
    live: Date.now() - st.mtimeMs < LIVE_WINDOW_MS,
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
      if (typeof text === 'string' && text.trim() && !text.trim().startsWith('<')) return text.trim().slice(0, 120);
    } catch {
      // partial line at the 64KB boundary
    }
  }
  return undefined;
}

export function discoverAgents(claudeRoot: string, projectSlug: string, id: string): AgentInfo[] {
  const sessionDir = join(claudeRoot, 'projects', projectSlug, id);
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
