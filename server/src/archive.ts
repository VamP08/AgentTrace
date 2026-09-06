// The archive: AgentTrace's own copy of every session it has indexed. The coding tool deletes
// transcripts after its retention period (30 days by default); the archive is what makes a
// session outlive that. Copies are made when a session is indexed and refreshed while it grows.
// The same folder keeps each repository's default-branch log, so commits survive a deleted
// working copy the way sessions survive the tool's cleanup.
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Session } from '@agenttrace/shared';
import { defaultBranch } from './git.js';
import { keyOf } from './repos.js';

export function archiveRoot(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'archive');
}

type Paths = Pick<Session, 'file' | 'dir' | 'fileHistory'>;

/** Where the coding tool keeps a session: transcript, its folder of subagents and spilled results, and its file history. */
export function livePaths(claudeRoot: string, projectSlug: string, sessionId: string): Paths {
  return pathsUnder(claudeRoot, projectSlug, sessionId);
}

/** Where AgentTrace keeps its copy of the same three things. Same layout, different root. */
export function archivePaths(claudeRoot: string, projectSlug: string, sessionId: string): Paths {
  return pathsUnder(archiveRoot(claudeRoot), projectSlug, sessionId);
}

function pathsUnder(root: string, projectSlug: string, sessionId: string): Paths {
  return {
    file: join(root, 'projects', projectSlug, `${sessionId}.jsonl`),
    dir: join(root, 'projects', projectSlug, sessionId),
    fileHistory: join(root, 'file-history', sessionId),
  };
}

function sizeOf(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return -1;
  }
}

/**
 * Copy a live session into the archive if the copy is missing or behind. Transcripts only ever
 * grow, so a size difference means new lines. Folders are copied whole; they are small.
 * Returns true when something was written. A session pruned under the current size limit is
 * skipped, or every pass would copy back what the last one deleted.
 */
export function archiveSession(claudeRoot: string, s: Pick<Session, 'archived' | 'projectSlug' | 'id'> & Paths): boolean {
  if (s.archived || loadPruned(claudeRoot).has(s.id)) return false;
  const to = archivePaths(claudeRoot, s.projectSlug, s.id);
  let wrote = false;
  try {
    if (sizeOf(to.file) !== sizeOf(s.file)) {
      mkdirSync(dirname(to.file), { recursive: true });
      copyFileSync(s.file, to.file);
      wrote = true;
    }
    if (existsSync(s.dir) && newerTree(s.dir, to.dir)) {
      cpSync(s.dir, to.dir, { recursive: true, force: true });
      wrote = true;
    }
    if (s.fileHistory && existsSync(s.fileHistory) && newerTree(s.fileHistory, to.fileHistory)) {
      cpSync(s.fileHistory, to.fileHistory, { recursive: true, force: true });
      wrote = true;
    }
  } catch {
    // an archive failure must never break reading the live session
  }
  return wrote;
}

/** True when any file under `from` is missing or larger in `to`'s copy. Cheap: names and sizes only. */
function newerTree(from: string, to: string): boolean {
  for (const name of readdirSync(from)) {
    const a = join(from, name);
    const b = join(to, name);
    const st = statSync(a);
    if (st.isDirectory()) {
      if (!existsSync(b) || newerTree(a, b)) return true;
    } else if (sizeOf(b) !== st.size) return true;
  }
  return false;
}

/** Count and size of everything archived, for the Setup screen. */
export function archiveStats(claudeRoot: string): { sessions: number; bytes: number; root: string } {
  const root = archiveRoot(claudeRoot);
  let sessions = 0, bytes = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        bytes += st.size;
        if (name.endsWith('.jsonl') && basename(dirname(dir)) === 'projects') sessions++;
      }
    }
  };
  walk(root);
  return { sessions, bytes, root };
}

/** Settings the person chooses, kept beside the archive. Missing or broken file means the defaults. */
export interface Settings {
  /** the archive is pruned back to this many bytes; null means it grows without limit */
  archiveCapBytes: number | null;
}

/** Below this a cap would delete almost everything the moment it was set, so it is refused. */
export const MIN_CAP_BYTES = 100e6;

export function settingsPath(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'settings.json');
}

export function loadSettings(claudeRoot: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(claudeRoot), 'utf8'));
    const cap = raw?.archiveCapBytes;
    if (typeof cap === 'number' && Number.isFinite(cap) && cap >= MIN_CAP_BYTES) return { archiveCapBytes: Math.floor(cap) };
  } catch {
    // no settings file yet, or unreadable: the defaults are what an untouched install has
  }
  return { archiveCapBytes: null };
}

export function saveSettings(claudeRoot: string, s: Settings): void {
  const before = loadSettings(claudeRoot).archiveCapBytes;
  mkdirSync(dirname(settingsPath(claudeRoot)), { recursive: true });
  writeFileSync(settingsPath(claudeRoot), JSON.stringify(s, null, 2));
  // Only a same or tighter limit keeps the skip list. More room, or none at all, means the person
  // wants those sessions kept again, so the next pass copies them back.
  const tighter = s.archiveCapBytes !== null && before !== null && s.archiveCapBytes <= before;
  if (!tighter) savePruned(claudeRoot, new Set());
}

function prunedPath(claudeRoot: string): string {
  return join(archiveRoot(claudeRoot), 'pruned.json');
}

/**
 * Sessions pruned under the limit in force. They are not copied again until the limit is raised
 * or removed; a session whose live original disappears meanwhile stays listed, since by then
 * there is nothing left to copy.
 */
export function loadPruned(claudeRoot: string): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(prunedPath(claudeRoot), 'utf8'));
    if (Array.isArray(raw)) return new Set(raw.filter((x): x is string => typeof x === 'string'));
  } catch {
    // never written, or unreadable: nothing is being skipped
  }
  return new Set();
}

function savePruned(claudeRoot: string, ids: Set<string>): void {
  try {
    // nothing skipped, no file: an empty list is the same state as never having pruned
    if (ids.size === 0) {
      rmSync(prunedPath(claudeRoot), { force: true });
      return;
    }
    mkdirSync(dirname(prunedPath(claudeRoot)), { recursive: true });
    writeFileSync(prunedPath(claudeRoot), JSON.stringify([...ids]));
  } catch {
    // failing to write it only costs the disk writes of one more copy
  }
}

export interface PruneResult {
  removed: { id: string; bytes: number }[];
  /** the archive's total size once pruning stopped */
  bytes: number;
  cap: number;
  /** sessions passed over while still over the cap because the archive holds their only copy */
  keptOnlyCopies: number;
}

/** Total size of a file or folder, 0 when it is not there. */
function bytesOf(p: string): number {
  let st;
  try {
    st = statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const name of readdirSync(p)) n += bytesOf(join(p, name));
  return n;
}

/** Delete one session's archived transcript, folder and file history together. Returns bytes freed. */
function removeArchived(claudeRoot: string, projectSlug: string, sessionId: string): number {
  const p = archivePaths(claudeRoot, projectSlug, sessionId);
  let freed = 0;
  for (const target of [p.file, p.dir, p.fileHistory]) {
    const n = bytesOf(target);
    try {
      rmSync(target, { recursive: true, force: true });
      freed += n;
    } catch {
      // locked or in use: leave it and let the next pass try again
    }
  }
  return freed;
}

/**
 * Shrink the archive to the cap by removing the oldest sessions first, oldest by when the
 * transcript last changed. A session whose live original is gone is never removed while any
 * session with a live original is left to remove: the archive is then the only copy there is.
 * When only those are left the pruning stops, still over the cap, and says so. The archived
 * commit logs under `git` are never touched. What it removes is remembered, so the next pass
 * does not copy it straight back in.
 */
export function pruneArchive(claudeRoot: string, capBytes: number): PruneResult {
  let bytes = archiveStats(claudeRoot).bytes;
  const removed: PruneResult['removed'] = [];
  let keptOnlyCopies = 0;
  if (bytes <= capBytes) return { removed, bytes, cap: capBytes, keptOnlyCopies };

  const projects = join(archiveRoot(claudeRoot), 'projects');
  const entries: { id: string; slug: string; updated: number; onlyCopy: boolean }[] = [];
  if (existsSync(projects)) {
    for (const slug of readdirSync(projects)) {
      let names: string[];
      try {
        names = readdirSync(join(projects, slug));
      } catch {
        continue; // not a folder, or unreadable
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = basename(name, '.jsonl');
        const live = livePaths(claudeRoot, slug, id).file;
        const onlyCopy = !existsSync(live);
        try {
          // the same mtime the session list shows as the session's last activity
          entries.push({ id, slug, onlyCopy, updated: statSync(onlyCopy ? join(projects, slug, name) : live).mtimeMs });
        } catch {
          // vanished between the listing and the stat
        }
      }
    }
  }
  entries.sort((a, b) => a.updated - b.updated);

  for (const e of entries) {
    if (bytes <= capBytes) break;
    if (e.onlyCopy) {
      keptOnlyCopies++;
      continue;
    }
    const freed = removeArchived(claudeRoot, e.slug, e.id);
    if (freed <= 0) continue;
    bytes -= freed;
    removed.push({ id: e.id, bytes: freed });
  }
  if (removed.length) savePruned(claudeRoot, new Set([...loadPruned(claudeRoot), ...removed.map((r) => r.id)]));
  return { removed, bytes, cap: capBytes, keptOnlyCopies };
}

/** One commit of a repository's default branch, as kept in the archive. */
export interface ArchivedCommit {
  sha: string;
  ts: string;
  subject: string;
  body: string;
  files: { path: string; added: number; removed: number }[];
}

export interface ArchivedLog {
  root: string;
  branch: string;
  /** the commit the branch pointed at when the copy was made */
  head: string;
  archivedAt: string;
  commits: ArchivedCommit[];
}

function logPath(claudeRoot: string, root: string): string {
  return join(archiveRoot(claudeRoot), 'git', keyOf(root).replace(/[^a-z0-9]+/g, '-') + '.json');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** The archived log of a repository, or undefined when none was ever made. */
export function archivedCommits(claudeRoot: string, root: string): ArchivedLog | undefined {
  try {
    const raw = JSON.parse(readFileSync(logPath(claudeRoot, root), 'utf8'));
    return raw && Array.isArray(raw.commits) ? (raw as ArchivedLog) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copy a repository's default-branch log into the archive when the branch has moved since the
 * last copy. One `rev-parse` per pass when nothing changed; the full log only when it did.
 * Returns true when a copy was written.
 */
export function archiveLog(claudeRoot: string, root: string): boolean {
  if (!existsSync(root)) return false;
  let branch: string, head: string;
  try {
    branch = defaultBranch(root);
    head = git(root, ['rev-parse', branch]);
  } catch {
    return false; // not a repository, or no commits yet
  }
  const have = archivedCommits(claudeRoot, root);
  if (have && have.head === head) return false;
  let out: string;
  try {
    // \x1d starts a record, \x1f separates its fields, \x1e ends them; numstat lines follow.
    out = git(root, ['log', branch, '--no-merges', '--date=iso-strict', '--format=%x1d%H%x1f%cI%x1f%s%x1f%b%x1e', '--numstat']);
  } catch {
    return false;
  }
  const commits: ArchivedCommit[] = [];
  for (const rec of out.split('\x1d')) {
    if (!rec.trim()) continue;
    const [header, rest = ''] = rec.split('\x1e');
    const [sha, ts, subject, body = ''] = header.split('\x1f');
    if (!sha) continue;
    const files = rest
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((p) => p.length === 3)
      .map(([a, r, path]) => ({ path, added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r) }));
    commits.push({ sha, ts, subject, body: body.trim(), files });
  }
  const log: ArchivedLog = { root, branch, head, archivedAt: new Date().toISOString(), commits };
  try {
    mkdirSync(dirname(logPath(claudeRoot, root)), { recursive: true });
    writeFileSync(logPath(claudeRoot, root), JSON.stringify(log));
    return true;
  } catch {
    return false;
  }
}
