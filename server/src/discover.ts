// Find sessions and their subagents without parsing whole files. Sessions come from two places:
// the coding tool's own projects folder, and AgentTrace's archive of sessions it has indexed.
// The live copy wins while it exists; the archive answers once the tool has cleaned up.
// Title, cwd and start time come from the first and last 64KB of each transcript.
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync, readFileSync, mkdirSync, writeFileSync, type Stats } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentInfo, Session } from '@agenttrace/shared';
import { archiveRoot, livePaths } from './archive.js';

const LIVE_WINDOW_MS = 30_000;
const PEEK_BYTES = 64 * 1024;

// Each transcript's description as of its size and mtime. Everything in it comes from the file's
// first and last 64 KB, so an unchanged file needs no second look. Without this every call opened
// and read ~2,000 files — 71 s of a 180 s profile — and it is called by every session request, by
// the page's fifteen-second poll, by the index pass and by the archive sweep. Rebuilt on each call
// from the files actually seen, so a deleted transcript drops out.
let described = new Map<string, { size: number; mtimeMs: number; session: Session }>();

// The same cache on disk, so a restart does not begin cold. A cold listing reads every file and took
// 8.7 to 17.8 s in one synchronous hold, measured, which was the longest stall left in the server and
// the first thing anyone opening the app waited for. Written at most once a minute, and only after a
// listing described something new; a cache, so a missing or broken file only costs time.
let loadedFrom: string | undefined;
/** Bumped whenever a session's description gains or changes a field. 2: `automated`, repaired titles. */
const DESCRIBED_VERSION = 2;
const savedAt = new Map<string, number>();
const describedFile = (claudeRoot: string) => join(claudeRoot, 'agenttrace', 'sessions-described.json');

function loadDescribed(claudeRoot: string) {
  if (loadedFrom === claudeRoot) return;
  loadedFrom = claudeRoot;
  try {
    const saved = JSON.parse(readFileSync(describedFile(claudeRoot), 'utf8'));
    // a copy written before the description gained a field is not trusted; one cold listing rebuilds it
    described = saved?.version === DESCRIBED_VERSION ? new Map(Object.entries(saved.entries)) : new Map();
  } catch {
    described = new Map();
  }
}

function saveDescribed(claudeRoot: string) {
  if (Date.now() - (savedAt.get(claudeRoot) ?? 0) < 60_000) return;
  savedAt.set(claudeRoot, Date.now());
  try {
    mkdirSync(join(claudeRoot, 'agenttrace'), { recursive: true });
    writeFileSync(describedFile(claudeRoot), JSON.stringify({ version: DESCRIBED_VERSION, entries: Object.fromEntries(described) }));
  } catch {
    // a cache; failing to write it costs the next start some time and nothing else
  }
}

export function discoverSessions(claudeRoot: string): Session[] {
  loadDescribed(claudeRoot);
  const before = described;
  const byId = new Map<string, Session>();
  const seen = new Map<string, { size: number; mtimeMs: number; session: Session }>();
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
          byId.set(id, describeCached(slug, archived, livePaths(root, slug, id), seen));
        } catch {
          // unreadable file: skip rather than fail the whole list
        }
      }
    }
  };
  scan(claudeRoot, false);
  scan(archiveRoot(claudeRoot), true);
  described = seen;
  // a new or changed transcript produced a fresh description object; unchanged ones reused the old
  if ([...seen].some(([file, v]) => before.get(file)?.session !== v.session)) saveDescribed(claudeRoot);
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The description of one transcript, from the cache when its size and mtime are unchanged. */
function describeCached(slug: string, archived: boolean, paths: { file: string; dir: string; fileHistory: string }, into: typeof described): Session {
  const st = statSync(paths.file);
  const hit = described.get(paths.file);
  const session = hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs ? hit.session : describeSession(slug, archived, paths, st);
  into.set(paths.file, { size: st.size, mtimeMs: st.mtimeMs, session });
  // live depends on the clock, not the file, so it is worked out fresh every time
  return { ...session, live: !archived && Date.now() - st.mtimeMs < LIVE_WINDOW_MS };
}

/**
 * One session by id: look for its file under each project folder, live copy first, then the
 * archive. It used to list every session and pick one out, which is ~2,000 stats, and opening a
 * session asks for it four times. `id` must already be validated as a session id by the caller.
 */
export function findSession(claudeRoot: string, id: string): Session | undefined {
  loadDescribed(claudeRoot);
  for (const [root, archived] of [[claudeRoot, false], [archiveRoot(claudeRoot), true]] as const) {
    const projectsDir = join(root, 'projects');
    if (!existsSync(projectsDir)) continue;
    for (const slug of readdirSync(projectsDir)) {
      const paths = livePaths(root, slug, id);
      if (!existsSync(paths.file)) continue;
      try {
        return describeCached(slug, archived, paths, described);
      } catch {
        // unreadable: keep looking, as the full listing would have skipped it
      }
    }
  }
  return undefined;
}

function describeSession(projectSlug: string, archived: boolean, paths: { file: string; dir: string; fileHistory: string }, st: Stats): Session {
  const { file } = paths;
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
    automated: /^sdk/.test(lastMatch(tail, /"entrypoint":"([^"]*)"/) ?? firstMatch(head, /"entrypoint":"([^"]*)"/) ?? ''),
    ...paths,
  };
}

/**
 * The title a person would recognise. The coding tool's own `customTitle` is sometimes the first
 * prompt with its line breaks deleted outright — "…the record. Reade:\Work\…", "thenjournal" — so
 * when it is nothing but that, the prompt is shown with its spaces kept. A title somebody chose
 * is never replaced.
 */
function title(tail: string, head: string): string {
  const custom = lastMatch(tail, /"customTitle":"((?:[^"\\]|\\.)*)"/);
  const first = firstUserText(head);
  if (custom && first) {
    const bare = (s: string) => s.replace(/\s+/g, '').replace(/…$/, '');
    const c = bare(custom);
    if (c.length >= 20 && (bare(first).startsWith(c) || c.startsWith(bare(first)))) return first;
  }
  return (
    custom ??
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
        // line breaks become spaces here, where it is known they separate words
        const t = text.trim().replace(/\s+/g, ' ');
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
