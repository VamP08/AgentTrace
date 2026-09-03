// Build the project index: one entry per repository, made of the turns that edited it.
// A turn belongs to every repository it edited. A turn writing into a record folder such as
// docs/<Project>/ counts as <Project>, because those notes are that project's own record.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { Event, Project, ProjectDetail, ProjectKind, Session, TurnRef } from '@agenttrace/shared';
import { discoverSessions, sessionFile } from './discover.js';
import { findManifest } from './docs.js';
import { parseFile } from './parse.js';

interface SessionIndex {
  /** file size and mtime the index was built from, so a changed transcript re-indexes */
  bytes: number;
  updatedAt: string;
  turns: TurnRef[];
}

type IndexFile = Record<string, SessionIndex>;

const repoCache = new Map<string, string | null>();
const recordOwner = new Map<string, string | null>();

/**
 * The git repository a file belongs to, or null. A folder that no longer exists, because it was
 * renamed or deleted since the session ran, is answered from its nearest surviving ancestor, so
 * work in a folder that has since moved still lands on the repository it was part of.
 * Cached per folder, since the same folder is asked about thousands of times.
 */
function repoOf(dir: string): string | null {
  const hit = repoCache.get(dir);
  if (hit !== undefined) return hit;
  let probe = dir;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  let root: string | null = null;
  if (existsSync(probe)) {
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: probe, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim() || null;
    } catch {
      root = null;
    }
  }
  repoCache.set(dir, root);
  return root;
}

/** Windows paths differ only by case for the same folder; one spelling has to win or a project splits in two. */
const canonical = new Map<string, string>();
function canon(p: string): string {
  const key = resolve(p).replace(/[\/]+$/, '').toLowerCase();
  const seen = canonical.get(key);
  if (seen) return seen;
  const chosen = resolve(p).replace(/[\/]+$/, '');
  canonical.set(key, chosen);
  return chosen;
}

/**
 * If a path sits inside some project's record folder, that project owns it.
 * The record folder is found by reading agenttrace.json files: a record root of
 * `E:/…/docs/AgentTrace` means anything under it belongs to the AgentTrace repository.
 */
function recordOwnerOf(dir: string, manifests: { repoDir: string; root: string }[]): string | null {
  const hit = recordOwner.get(dir);
  if (hit !== undefined) return hit;
  let owner: string | null = null;
  const norm = resolve(dir).toLowerCase();
  for (const m of manifests) {
    const r = resolve(m.root).toLowerCase();
    if (norm === r || norm.startsWith(r + '\\') || norm.startsWith(r + '/')) {
      owner = repoOf(m.repoDir) ?? m.repoDir;
      break;
    }
  }
  recordOwner.set(dir, owner);
  return owner;
}

/** Files a turn wrote, from its Write and Edit calls, made absolute against the session folder. */
function editedPaths(events: Event[], cwd: string): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind !== 'tool_call') continue;
    if (e.name !== 'Write' && e.name !== 'Edit' && e.name !== 'NotebookEdit') continue;
    const input = (e.input ?? {}) as Record<string, unknown>;
    const p = input.file_path ?? input.notebook_path;
    if (typeof p === 'string' && p) out.push(resolve(cwd, p));
  }
  return out;
}

/** Split one session's events into turns and attach each turn to the repositories it edited. */
export function turnsOf(events: Event[], session: Session, manifests: { repoDir: string; root: string }[]): TurnRef[] {
  const turns: TurnRef[] = [];
  let cur: { ref: TurnRef; events: Event[] } | undefined;
  const close = () => {
    if (!cur) return;
    const counts: Record<string, number> = {};
    for (const p of editedPaths(cur.events, session.cwd)) {
      const dir = dirname(p);
      const owner = canon(recordOwnerOf(dir, manifests) ?? repoOf(dir) ?? dir);
      counts[owner] = (counts[owner] ?? 0) + 1;
    }
    cur.ref.edits = counts;
    turns.push(cur.ref);
  };
  for (const e of events) {
    if (e.kind === 'user') {
      close();
      cur = {
        ref: { sessionId: session.id, n: turns.length + 1, prompt: e.text.split('\n')[0].slice(0, 200), startTs: e.ts, endTs: e.ts, calls: 0, failed: 0, edits: {}, also: [] },
        events: [],
      };
      continue;
    }
    if (!cur) continue;
    cur.events.push(e);
    if (e.ts) cur.ref.endTs = e.ts;
    if (e.kind === 'tool_call') cur.ref.calls++;
    if (e.kind === 'tool_result' && e.isError) cur.ref.failed++;
  }
  close();
  return turns;
}

function indexPath(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'projects-index.json');
}

function loadIndex(claudeRoot: string): IndexFile {
  try {
    return JSON.parse(readFileSync(indexPath(claudeRoot), 'utf8'));
  } catch {
    return {};
  }
}

function saveIndex(claudeRoot: string, idx: IndexFile) {
  try {
    mkdirSync(dirname(indexPath(claudeRoot)), { recursive: true });
    writeFileSync(indexPath(claudeRoot), JSON.stringify(idx));
  } catch {
    // the index is a cache; failing to write it only costs time next run
  }
}

/** Every agenttrace.json reachable from the sessions' folders, so record folders can be attributed. */
function manifestsFor(sessions: Session[]): { repoDir: string; root: string }[] {
  const seen = new Map<string, { repoDir: string; root: string }>();
  const dirs = new Set<string>();
  for (const s of sessions) if (s.cwd) dirs.add(s.cwd);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    // one level down as well: a parent folder often holds several project repositories
    const found = findManifest(dir);
    if (found) seen.set(found.root, { repoDir: found.repoDir, root: found.root });
    try {
      for (const name of readdirSync(dir)) {
        const child = join(dir, name);
        if (!statSync(child).isDirectory()) continue;
        const f = findManifest(child);
        if (f) seen.set(f.root, { repoDir: f.repoDir, root: f.root });
      }
    } catch {
      // unreadable folder: skip
    }
  }
  return [...seen.values()];
}

/** Index every session's turns, reusing cached entries whose transcript has not changed. */
export async function buildIndex(claudeRoot: string): Promise<{ turns: TurnRef[]; sessions: Map<string, Session> }> {
  const sessions = discoverSessions(claudeRoot);
  const manifests = manifestsFor(sessions);
  const cached = loadIndex(claudeRoot);
  const next: IndexFile = {};
  const all: TurnRef[] = [];
  for (const s of sessions) {
    const hit = cached[s.id];
    if (hit && hit.bytes === s.bytes && hit.updatedAt === s.updatedAt) {
      next[s.id] = hit;
      all.push(...hit.turns);
      continue;
    }
    const parsed = await parseFile(sessionFile(claudeRoot, s.projectSlug, s.id), { sessionId: s.id });
    const turns = turnsOf(parsed.events, s, manifests);
    next[s.id] = { bytes: s.bytes, updatedAt: s.updatedAt, turns };
    all.push(...turns);
  }
  saveIndex(claudeRoot, next);
  return { turns: all, sessions: new Map(sessions.map((s) => [s.id, s])) };
}

/** What sort of place this is, so the sidebar can put real repositories first and fold the rest away. */
function kindOf(root: string, claudeRoot: string): ProjectKind {
  const low = resolve(root).toLowerCase();
  const temp = resolve(tmpdir()).toLowerCase();
  const cfg = resolve(claudeRoot).toLowerCase();
  if (low.startsWith(temp)) return 'scratch';
  if (low.startsWith(cfg) || low.startsWith(resolve(homedir(), '.claude').toLowerCase())) return 'config';
  const r = repoOf(root);
  return r && canon(r) === canon(root) ? 'repo' : 'folder';
}

function remoteOf(root: string): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Fold turns into projects. A turn with edits in two repositories counts in both, marked. */
export function foldProjects(turns: TurnRef[], sessions: Map<string, Session>, claudeRoot = ''): Project[] {
  const byRoot = new Map<string, Project & { sessionSet: Set<string> }>();
  for (const t of turns) {
    const roots = Object.keys(t.edits);
    if (roots.length === 0) continue; // a turn that wrote nothing belongs to no project
    for (const root of roots) {
      let p = byRoot.get(root);
      if (!p) {
        const manifest = existsSync(join(root, 'agenttrace.json')) ? findManifest(root) : undefined;
        p = {
          root,
          name: basename(root),
          kind: kindOf(root, claudeRoot),
          remote: remoteOf(root),
          turns: 0, calls: 0, failed: 0, sessions: [],
          firstTs: t.startTs, lastTs: t.endTs, live: false,
          recordRoot: manifest?.root,
          sessionSet: new Set<string>(),
        };
        byRoot.set(root, p);
      }
      p.turns++;
      p.calls += t.calls;
      p.failed += t.failed;
      p.sessionSet.add(t.sessionId);
      if (t.startTs && t.startTs < p.firstTs) p.firstTs = t.startTs;
      if (t.endTs && t.endTs > p.lastTs) p.lastTs = t.endTs;
      if (sessions.get(t.sessionId)?.live) p.live = true;
    }
  }
  const order: Record<ProjectKind, number> = { repo: 0, folder: 1, config: 2, scratch: 3 };
  return [...byRoot.values()]
    .map(({ sessionSet, ...p }) => ({ ...p, sessions: [...sessionSet] }))
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.lastTs < b.lastTs ? 1 : -1));
}

export function projectDetail(root: string, turns: TurnRef[], sessions: Map<string, Session>, list: Project[]): ProjectDetail | undefined {
  const p = list.find((x) => x.root === root);
  if (!p) return undefined;
  const mine = turns
    .filter((t) => t.edits[root])
    .map((t) => ({ ...t, also: Object.keys(t.edits).filter((r) => r !== root) }))
    .sort((a, b) => (a.startTs < b.startTs ? 1 : -1));
  const perSession = new Map<string, number>();
  for (const t of mine) perSession.set(t.sessionId, (perSession.get(t.sessionId) ?? 0) + 1);
  const sessionList = [...perSession.entries()]
    .map(([id, n]) => {
      const s = sessions.get(id);
      return { id, title: s?.title ?? id, turns: n, updatedAt: s?.updatedAt ?? '', live: !!s?.live };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { ...p, turnList: mine, sessionList };
}
