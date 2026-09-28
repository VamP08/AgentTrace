// Build the project index: one entry per GitHub repository, made of the sessions that worked in
// it. A session belongs to every repository it edited files in; a session that edited nothing
// belongs to the repository its working directory was in; the rest are miscellaneous.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Event, MiscSession, Project, ProjectDetail, ProjectIndex, Session, SessionLink } from '@agenttrace/shared';
import { discoverSessions } from './discover.js';
import { findManifest } from './docs.js';
import { keyOf, loadRegistry, lookup, saveRegistry, upsert, type Registry } from './repos.js';
import { parseFile } from './parse.js';

/** What one session's transcript says about where it worked. Cached per session. */
interface SessionFacts {
  bytes: number;
  updatedAt: string;
  /** canonical repository root -> edits inside it */
  edits: Record<string, number>;
  /** repository root of the folder the session ran in, if any */
  cwdRepo: string | null;
  calls: number;
  failed: number;
  startTs: string;
  endTs: string;
  /** short hashes of commits the transcript shows being made, so a session that edits through the shell still counts */
  commits: string[];
}

const GIT_COMMIT = /\bgit\b[^\n|&;]*\bcommit\b/;
/** git prints "[main 1a2b3c4] subject" for every commit it makes. */
const COMMIT_LINE = /^\[[^\]\n]* ([0-9a-f]{7,40})\]/m;

/** Every commit the transcript shows being made: the hash git printed, and the folder the command ran in. */
export function commitsMade(events: Event[], session: Session): { sha: string; cwd: string }[] {
  const results = new Map<string, string>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e.content);
  const out: { sha: string; cwd: string }[] = [];
  for (const e of events) {
    if (e.kind !== 'tool_call' || e.name !== 'Bash') continue;
    const command = (e.input as Record<string, unknown> | undefined)?.command;
    if (typeof command !== 'string' || !GIT_COMMIT.test(command)) continue;
    const result = results.get(e.toolUseId) ?? '';
    // A quiet commit prints nothing; when the same command then asks git log for it, the first
    // line of that log is the commit just made.
    const m = COMMIT_LINE.exec(result) ?? (/git\s+log/.test(command) ? /^([0-9a-f]{7,40}) /m.exec(result) : null);
    if (m) out.push({ sha: m[1], cwd: e.cwd ?? session.cwd });
  }
  return out;
}

type IndexFile = Record<string, SessionFacts>;

const repoCache = new Map<string, string | null>();
const remoteCache = new Map<string, string | undefined>();
const canonical = new Map<string, string>();

// The registry remembers every repository seen, so a folder deleted or moved since still answers
// with its remote, first commit and record path. buildFacts loads it; tests may set it directly.
let registry: Registry = { version: 1, repos: {} };
export function useRegistry(reg: Registry) {
  registry = reg;
}

/** Windows paths differ only by case for the same folder; one spelling has to win or a project splits in two. */
export function canon(p: string): string {
  const key = resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  const seen = canonical.get(key);
  if (seen) return seen;
  const chosen = resolve(p).replace(/[\\/]+$/, '');
  canonical.set(key, chosen);
  return chosen;
}

/**
 * Git's own repository discovery, without starting git: walk up to the first `.git`. A directory
 * means that folder is the working copy. A file means a worktree or a submodule: it names a gitdir,
 * and a worktree's gitdir holds a `commondir` leading back to the main repository, whose parent is
 * the working copy every worktree of it belongs to. A submodule's gitdir has no `commondir` and is
 * its own repository. Returns null outside any repository, and undefined for a layout it does not
 * recognise, which is left to git.
 *
 * This exists because starting git costs 60 to 480 ms per call on this machine — `git --version`
 * alone took 280 — and a warm project-index pass spent 20.6 s of its 27.9 in these calls, blocking
 * every request meanwhile. The walk is a handful of stat calls.
 */
export function repoRootByWalk(start: string): string | null | undefined {
  for (let dir = resolve(start); ; ) {
    const dotgit = join(dir, '.git');
    const st = statSync(dotgit, { throwIfNoEntry: false });
    if (st?.isDirectory()) return dir;
    if (st?.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'));
      if (!m) return undefined;
      const gitdir = resolve(dir, m[1].trim());
      const commondir = join(gitdir, 'commondir');
      if (!existsSync(commondir)) return dir;
      const common = resolve(gitdir, readFileSync(commondir, 'utf8').trim());
      return /[\\/]\.git$/i.test(common) ? dirname(common) : undefined;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The git repository a folder belongs to, or null. A folder that no longer exists is answered
 * from its nearest surviving ancestor, so work in a folder renamed since still lands on its
 * repository. Cached per folder.
 */
export function repoOf(dir: string): string | null {
  const hit = repoCache.get(dir);
  if (hit !== undefined) return hit;
  if (!existsSync(dir)) {
    // Gone from disk: the registry knows which repository it was in, and never confuses it with
    // whatever repository happens to own the nearest surviving ancestor.
    const known = lookup(registry, dir);
    if (known) {
      const out = canon(known.root);
      repoCache.set(dir, out);
      return out;
    }
  }
  let probe = dir;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  let root: string | null | undefined = existsSync(probe) ? repoRootByWalk(probe) : null;
  if (root === undefined && existsSync(probe)) {
    try {
      // The common git dir is shared by every worktree of a repository; its parent is the main
      // working copy. Asking for the top level alone would make each worktree its own project.
      const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: probe, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim();
      root = common ? (common.replace(/[\\/]\.git$/i, '') || null) : null;
      if (root && /[\\/]\.git$/i.test(common) === false) {
        // a bare or unusual layout: fall back to the top level of this working copy
        root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: probe, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim() || null;
      }
    } catch {
      root = null;
    }
  }
  const out = root ? canon(root) : null;
  // ponytail: a walk that finds `.git` answers even where git would refuse (safe.directory
  // ownership checks); for attributing edits to a repository that is the right answer.
  repoCache.set(dir, out);
  return out;
}

const rootCommitCache = new Map<string, string | undefined>();
/** The first commit of a repository: the same in every clone and worktree, and there before any push. */
export function rootCommitOf(root: string): string | undefined {
  if (rootCommitCache.has(root)) return rootCommitCache.get(root);
  // The first commit never changes once it exists, so the registry's answer is final and git is
  // only asked for a repository it has not seen, or one with no commit yet. Each git start costs
  // 60 to 480 ms here, and this was asked for every repository on every project-index request.
  let sha = registry.repos[keyOf(root)]?.rootCommit;
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim().split('\n').pop() || undefined;
    } catch {
      sha = undefined;
    }
  }
  rootCommitCache.set(root, sha);
  return sha;
}

export function remoteOf(root: string): string | undefined {
  if (remoteCache.has(root)) return remoteCache.get(root);
  // Registry first, for the same reason as rootCommitOf. A repository with no remote is still
  // asked each time, since pushing it is exactly the change that makes it a GitHub project.
  // ponytail: an origin re-pointed at a different URL is not noticed; clear the registry entry.
  let url = registry.repos[keyOf(root)]?.remote;
  if (!url) {
    try {
      url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim() || undefined;
    } catch {
      url = undefined;
    }
  }
  remoteCache.set(root, url);
  return url;
}

/** "github.com/owner/repo" from any of the ways a GitHub remote is written, or undefined for other hosts. */
export function githubId(remote?: string): string | undefined {
  if (!remote) return undefined;
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote);
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

/**
 * If a path sits inside some project's record folder, that project's repository owns it. A record
 * root of `E:/…/docs/AgentTrace` means anything under it is AgentTrace's own notes.
 */
function recordOwnerOf(dir: string, manifests: { repoDir: string; root: string }[]): string | null {
  const norm = resolve(dir).toLowerCase();
  for (const m of manifests) {
    const r = resolve(m.root).toLowerCase();
    if (norm === r || norm.startsWith(r + '\\') || norm.startsWith(r + '/')) return repoOf(m.repoDir) ?? canon(m.repoDir);
  }
  return null;
}

/** Everything one transcript says about where it worked. Relative paths resolve against the line's own cwd. */
export function sessionFacts(events: Event[], session: Session, manifests: { repoDir: string; root: string }[]): SessionFacts {
  const edits: Record<string, number> = {};
  let calls = 0, failed = 0;
  let startTs = '', endTs = '';
  const results = new Map<string, boolean>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e.isError);
  for (const e of events) {
    if (e.ts) { if (!startTs) startTs = e.ts; endTs = e.ts; }
    if (e.kind !== 'tool_call') continue;
    calls++;
    if (results.get(e.toolUseId)) failed++;
    if (e.name !== 'Write' && e.name !== 'Edit' && e.name !== 'NotebookEdit') continue;
    const input = (e.input ?? {}) as Record<string, unknown>;
    const p = input.file_path ?? input.notebook_path;
    if (typeof p !== 'string' || !p) continue;
    const abs = resolve(e.cwd ?? session.cwd, p);
    const dir = dirname(abs);
    const owner = recordOwnerOf(dir, manifests) ?? repoOf(dir);
    if (!owner) continue; // edits outside any repository belong to no project
    edits[owner] = (edits[owner] ?? 0) + 1;
  }
  // A session that edits through the shell (sed, heredocs) shows no Write or Edit call, but the
  // commits it makes are in the transcript; each one counts as an edit in the repository it landed in.
  const commits = commitsMade(events, session);
  for (const c of commits) {
    const owner = repoOf(resolve(c.cwd));
    if (owner) edits[owner] = (edits[owner] ?? 0) + 1;
  }
  return { bytes: session.bytes, updatedAt: session.updatedAt, edits, cwdRepo: session.cwd ? repoOf(session.cwd) : null, calls, failed, startTs: startTs || session.startedAt, endTs: endTs || session.updatedAt, commits: commits.map((c) => c.sha) };
}

function indexPath(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'projects-index.json');
}

function loadIndex(claudeRoot: string): { sessions?: IndexFile; manifests?: string } {
  try {
    const raw = JSON.parse(readFileSync(indexPath(claudeRoot), 'utf8'));
    return raw && raw.version === 6 ? raw : {};
  } catch {
    return {};
  }
}

function saveIndex(claudeRoot: string, sessions: IndexFile, manifests: string) {
  try {
    mkdirSync(dirname(indexPath(claudeRoot)), { recursive: true });
    writeFileSync(indexPath(claudeRoot), JSON.stringify({ version: 6, manifests, sessions }));
  } catch {
    // the index is a cache; failing to write it only costs time next run
  }
}

/** Every agenttrace.json reachable from the sessions' folders and one level below, so record folders can be attributed. */
function manifestsFor(sessions: Session[]): { repoDir: string; root: string }[] {
  const seen = new Map<string, { repoDir: string; root: string }>();
  for (const dir of new Set(sessions.map((s) => s.cwd).filter(Boolean))) {
    if (!existsSync(dir)) continue;
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

// Requests that arrive while a pass is running share it. Without this each poll started its own
// full pass, and under the page's polling six were measured running at once, all over the same files.
let inflight: Promise<{ facts: Map<string, SessionFacts>; sessions: Map<string, Session> }> | undefined;

/** Facts for every session, reusing cached entries whose transcript has not changed. */
export function buildFacts(claudeRoot: string): Promise<{ facts: Map<string, SessionFacts>; sessions: Map<string, Session> }> {
  inflight ??= buildFactsOnce(claudeRoot).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

async function buildFactsOnce(claudeRoot: string): Promise<{ facts: Map<string, SessionFacts>; sessions: Map<string, Session> }> {
  const sessions = discoverSessions(claudeRoot);
  useRegistry(loadRegistry(claudeRoot));
  const manifests = manifestsFor(sessions);
  // Records the registry knows of count too, even when no session ran near their repository.
  for (const e of Object.values(registry.repos)) {
    if (e.record && !manifests.some((m) => keyOf(m.root) === keyOf(e.record!))) manifests.push({ repoDir: e.root, root: e.record });
  }
  // Attribution depends on which record folders exist, so a new agenttrace.json anywhere
  // invalidates every cached session; otherwise old sessions would keep their old owners.
  const manifestKey = manifests.map((m) => `${m.repoDir}=>${m.root}`).sort().join('|');
  const loaded = loadIndex(claudeRoot);
  const cached: IndexFile = loaded.manifests === manifestKey ? (loaded.sessions ?? {}) : {};
  const next: IndexFile = {};
  // Copying into the archive is not done here. It used to be, "cheap when nothing changed" — which
  // on 1,949 sessions was nine seconds of stat walks per request. sweepArchive does it on a timer.
  for (const s of sessions) {
    const hit = cached[s.id];
    if (hit && hit.bytes === s.bytes && hit.updatedAt === s.updatedAt) {
      next[s.id] = hit;
      continue;
    }
    const parsed = await parseFile(s.file, { sessionId: s.id });
    next[s.id] = sessionFacts(parsed.events, s, manifests);
  }
  saveIndex(claudeRoot, next, manifestKey);
  rememberRepos(claudeRoot, next);
  return { facts: new Map(Object.entries(next)), sessions: new Map(sessions.map((s) => [s.id, s])) };
}

/** Refresh the registry with every repository on disk this pass: remote, first commit, record path. */
function rememberRepos(claudeRoot: string, facts: IndexFile) {
  const roots = new Set<string>();
  for (const f of Object.values(facts)) {
    for (const r of Object.keys(f.edits)) roots.add(r);
    if (f.cwdRepo) roots.add(f.cwdRepo);
  }
  const now = new Date().toISOString();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const manifest = existsSync(join(root, 'agenttrace.json')) ? findManifest(root) : undefined;
    upsert(registry, { root, remote: remoteOf(root), rootCommit: rootCommitOf(root), record: manifest?.root, project: manifest?.manifest.project, seen: now });
    // The default-branch log is archived by the sweep, not here: one git start per repository per
    // request was 3.5 s of every pass.
  }
  saveRegistry(claudeRoot, registry);
}

/** Identity and record location of one repository: from git while the folder exists, from the registry once it does not. */
function describeRepo(root: string): Pick<Project, 'id' | 'kind' | 'name' | 'root' | 'remote' | 'recordRoot' | 'recordMissing' | 'gone'> {
  const remote = remoteOf(root);
  const gh = githubId(remote);
  const rootCommit = rootCommitOf(root);
  const manifest = existsSync(join(root, 'agenttrace.json')) ? findManifest(root) : undefined;
  const recordRoot = manifest?.root ?? registry.repos[keyOf(root)]?.record;
  return {
    id: gh ?? (rootCommit ? `commit:${rootCommit}` : root),
    kind: gh ? 'github' : 'local',
    name: gh ? gh.slice('github.com/'.length) : basename(root),
    root,
    remote,
    recordRoot,
    recordMissing: !!recordRoot && !existsSync(recordRoot),
    gone: !existsSync(root),
  };
}

/** A repository no session has touched yet, so a dossier can still describe its history. */
export function bareProject(root: string): ProjectDetail {
  return { ...describeRepo(root), sessions: [], edits: 0, calls: 0, failed: 0, firstTs: '', lastTs: '', live: false, sessionList: [], neighbours: [] };
}

/** Fold session facts into projects, GitHub repositories first, and the misc list. */
export function foldProjects(facts: Map<string, SessionFacts>, sessions: Map<string, Session>): ProjectIndex {
  const byId = new Map<string, Project>();
  const misc: MiscSession[] = [];
  const place = (root: string, s: Session, f: SessionFacts, link: SessionLink) => {
    const d = describeRepo(root);
    let p = byId.get(d.id);
    if (!p) {
      p = { ...d, sessions: [], edits: 0, calls: 0, failed: 0, firstTs: f.startTs, lastTs: f.endTs, live: false };
      byId.set(d.id, p);
    }
    p.sessions.push(link);
    p.edits += link.edits;
    p.calls += f.calls;
    p.failed += f.failed;
    if (f.startTs && f.startTs < p.firstTs) p.firstTs = f.startTs;
    if (f.endTs && f.endTs > p.lastTs) p.lastTs = f.endTs;
    if (s.live) p.live = true;
  };
  for (const [id, f] of facts) {
    const s = sessions.get(id);
    if (!s) continue;
    const roots = Object.entries(f.edits).sort((a, b) => b[1] - a[1]);
    if (roots.length > 0) {
      roots.forEach(([root, n], i) => place(root, s, f, { sessionId: id, edits: n, primary: i === 0, byCwdOnly: false }));
    } else if (f.cwdRepo) {
      place(f.cwdRepo, s, f, { sessionId: id, edits: 0, primary: true, byCwdOnly: true });
    } else {
      misc.push({ sessionId: id, folder: s.cwd ? basename(s.cwd) || s.cwd : s.projectSlug });
    }
  }
  const projects = [...byId.values()].sort((a, b) => (a.kind === b.kind ? (a.lastTs < b.lastTs ? 1 : -1) : a.kind === 'github' ? -1 : 1));
  for (const p of projects) p.sessions.sort((a, b) => Number(b.primary) - Number(a.primary) || b.edits - a.edits);
  return { projects, misc };
}

export function projectDetail(id: string, facts: Map<string, SessionFacts>, sessions: Map<string, Session>, index: ProjectIndex): ProjectDetail | undefined {
  const p = index.projects.find((x) => x.id === id);
  if (!p) return undefined;
  const sessionList = p.sessions
    .map((l) => {
      const s = sessions.get(l.sessionId);
      const f = facts.get(l.sessionId);
      return { id: l.sessionId, title: s?.title ?? l.sessionId, edits: l.edits, primary: l.primary, byCwdOnly: l.byCwdOnly, calls: f?.calls ?? 0, failed: f?.failed ?? 0, startedAt: s?.startedAt ?? '', updatedAt: s?.updatedAt ?? '', live: !!s?.live };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const counts = new Map<string, number>();
  for (const l of p.sessions) {
    for (const other of index.projects) {
      if (other.id === p.id) continue;
      if (other.sessions.some((x) => x.sessionId === l.sessionId)) counts.set(other.id, (counts.get(other.id) ?? 0) + 1);
    }
  }
  const neighbours = [...counts.entries()].map(([oid, n]) => ({ id: oid, name: index.projects.find((x) => x.id === oid)?.name ?? oid, sessions: n })).sort((a, b) => b.sessions - a.sessions);
  return { ...p, sessionList, neighbours };
}
