// The archive: AgentTrace's own copy of every session it has indexed. The coding tool deletes
// transcripts after its retention period (30 days by default); the archive is what makes a
// session outlive that. Copies are made when a session is indexed and refreshed while it grows.
// The same folder keeps each repository's default-branch log, so commits survive a deleted
// working copy the way sessions survive the tool's cleanup.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
 * grow, so a size difference means new lines. In the session's folders only the files that differ
 * are copied. They used to be copied whole whenever any one file in them had grown, on the belief
 * that they are small; a live session's folder of helper transcripts and spilled tool results was
 * recopied on every change, 17 s of a 180 s profile.
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
    if (existsSync(s.dir) && copyNewer(s.dir, to.dir)) wrote = true;
    if (s.fileHistory && existsSync(s.fileHistory) && copyNewer(s.fileHistory, to.fileHistory)) wrote = true;
  } catch {
    // an archive failure must never break reading the live session
  }
  return wrote;
}

/**
 * Copy every session that changed, then prune under the size limit, then count what the archive
 * holds. This used to run inline on every project-index request, where it was 54% of a 17-second
 * poll on 1,949 sessions; the HTTP server could answer nothing else meanwhile. Now it runs on a
 * timer, and yields to the event loop between sessions so a request waits for one copy at most.
 *
 * ponytail: one session's copy still blocks for as long as it takes — a 33 MB transcript is tens of
 * milliseconds. If that ever shows up in a measurement, swap copyFileSync for fs.promises.copyFile.
 */
export async function sweepArchive(claudeRoot: string, sessions: Session[], repoRoots: string[] = []): Promise<{ copied: number; stats: ReturnType<typeof archiveStats>; summary: string }> {
  // Each step is timed and the slowest named, because every step here is synchronous and one slow
  // one is a stall for every request: the line in the server log is how that gets found.
  let slowest = { what: '', ms: 0 };
  const timed = <T>(what: string, fn: () => T): T => {
    const t = Date.now();
    const out = fn();
    if (Date.now() - t > slowest.ms) slowest = { what, ms: Date.now() - t };
    return out;
  };
  const t0 = Date.now();
  let copied = 0;
  for (const s of sessions) {
    // A session a program started through the SDK is not copied: the owner's call on 2026-09-29, since
    // 2,726 of them were a plugin's workers and most of the archive's 2.4 GB. Copies made before stay.
    if (s.automated) continue;
    if (timed(`copy ${s.id}`, () => archiveSession(claudeRoot, s))) copied++;
    await new Promise((r) => setImmediate(r));
  }
  const t1 = Date.now();
  // each repository's default-branch log, so its commits outlive a deleted working copy
  let logs = 0;
  for (const root of repoRoots) {
    if (existsSync(root) && timed(`log ${root}`, () => archiveLog(claudeRoot, root))) logs++;
    await new Promise((r) => setImmediate(r));
  }
  const t2 = Date.now();
  const cap = loadSettings(claudeRoot).archiveCapBytes;
  if (cap !== null) timed('prune', () => pruneArchive(claudeRoot, cap));
  const tc = Date.now();
  const stats = await countArchive(claudeRoot);
  const counted = Date.now() - tc;
  const summary = `archive sweep: ${copied} of ${sessions.length} sessions copied in ${t1 - t0} ms, ${logs} of ${repoRoots.length} logs refreshed in ${t2 - t1} ms, counted in ${counted} ms (sliced), ${Date.now() - t0} ms in all; slowest single step ${slowest.ms} ms (${slowest.what})`;
  return { copied, stats, summary };
}

/** Copy each file under `from` that is missing from `to` or a different size there. Names and sizes only; true when anything was written. */
function copyNewer(from: string, to: string): boolean {
  let wrote = false;
  for (const name of readdirSync(from)) {
    const a = join(from, name);
    const b = join(to, name);
    const st = statSync(a);
    if (st.isDirectory()) {
      if (copyNewer(a, b)) wrote = true;
    } else if (sizeOf(b) !== st.size) {
      mkdirSync(to, { recursive: true });
      copyFileSync(a, b);
      wrote = true;
    }
  }
  return wrote;
}

/** Count and size of everything archived, for the Setup screen. */
/** Where AgentTrace keeps its copy of a project's record, one folder per project. */
export function recordArchivePath(claudeRoot: string, project: string): string {
  return join(archiveRoot(claudeRoot), 'records', project.replace(/[^A-Za-z0-9._-]+/g, '-'));
}

/**
 * Copy a project's record into the archive. The record is the only thing AgentTrace reads that a
 * person is expected to edit and tidy, and tidying is how forty-one files were once lost: the
 * record sat inside a folder whose owner cleaned it. The ownership rule keeps the record out of
 * anybody else's folders; this keeps a second copy in case the folder it owns is cleaned anyway.
 *
 * Markdown stays the source of truth — this is a copy, never read in preference to the original,
 * and the original is restored from git or from here by a person, never silently by the app.
 * Copies only when something changed, compared by every file's name, size and modification time,
 * so an unchanged record costs one stat per file.
 */
export function archiveRecord(claudeRoot: string, project: string, recordRoot: string): boolean {
  if (!project || !recordRoot || !existsSync(recordRoot)) return false;
  const dest = recordArchivePath(claudeRoot, project);
  const now = measure(recordRoot);
  if (now.files === 0) return false; // an empty or vanished record never overwrites a good copy
  const stampFile = join(dest, '.measure.json');
  if (existsSync(stampFile)) {
    try {
      const was = JSON.parse(readFileSync(stampFile, 'utf8')) as { sig?: string };
      if (was.sig === now.sig) return false;
    } catch {
      // an unreadable stamp just means copying again
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(recordRoot, dest, { recursive: true });
  writeFileSync(stampFile, JSON.stringify({ ...now, from: recordRoot, at: new Date().toISOString() }, null, 2));
  return true;
}

/**
 * Files, total bytes and newest mtime under a folder, and a signature of every file's path, size and
 * mtime. The totals alone miss a file swapped for another of the same size within one mtime tick.
 */
export function measure(root: string): { files: number; bytes: number; newest: number; sig: string } {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  const lines: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.measure.json') continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else {
        files += 1;
        bytes += s.size;
        newest = Math.max(newest, Math.floor(s.mtimeMs));
        lines.push(`${full.slice(root.length)} ${s.size} ${s.mtimeMs}`);
      }
    }
  };
  walk(root);
  const sig = createHash('sha1').update(lines.sort().join('\n')).digest('hex');
  return { files, bytes, newest, sig };
}

/** Every file in the archive, with the folder it sits in and its size. */
function* archiveFiles(dir: string): Generator<{ name: string; dir: string; size: number }> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* archiveFiles(p);
    else yield { name, dir, size: st.size };
  }
}

const isTranscript = (f: { name: string; dir: string }) => f.name.endsWith('.jsonl') && basename(dirname(f.dir)) === 'projects';

export function archiveStats(claudeRoot: string): { sessions: number; bytes: number; root: string } {
  const root = archiveRoot(claudeRoot);
  let sessions = 0, bytes = 0;
  for (const f of archiveFiles(root)) {
    bytes += f.size;
    if (isTranscript(f)) sessions++;
  }
  return { sessions, bytes, root };
}

/**
 * The same count, handing the event loop back every two hundred files. The walk is some 6,000 stats
 * and took 5 to 9 s in one piece on a busy machine — the longest hold left in the sweep once
 * everything else was sliced.
 */
async function countArchive(claudeRoot: string): Promise<ReturnType<typeof archiveStats>> {
  const root = archiveRoot(claudeRoot);
  let sessions = 0, bytes = 0, n = 0;
  for (const f of archiveFiles(root)) {
    bytes += f.size;
    if (isTranscript(f)) sessions++;
    if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
  }
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
 * last copy. A `stat` of `.git/logs/HEAD` settles the common case without starting git at all;
 * otherwise one `rev-parse` per pass when nothing changed, and the full log only when it did.
 * Returns true when a copy was written.
 */
export function archiveLog(claudeRoot: string, root: string): boolean {
  if (!existsSync(root)) return false;
  const have = archivedCommits(claudeRoot, root);
  // git is expensive at seventeen repositories a pass. `.git/logs/HEAD` is appended on every
  // commit and checkout, so a copy no older than it cannot be behind. A worktree (`.git` is a
  // file) or a repository with no reflog falls through to asking git.
  if (have) {
    try {
      const dotGit = join(root, '.git');
      if (statSync(dotGit).isDirectory() && statSync(join(dotGit, 'logs', 'HEAD')).mtimeMs <= Date.parse(have.archivedAt)) return false;
    } catch {
      // no reflog, unreadable, or an archivedAt that will not parse: ask git
    }
  }
  let branch: string, head: string;
  try {
    branch = defaultBranch(root);
    head = git(root, ['rev-parse', branch]);
  } catch {
    return false; // not a repository, or no commits yet
  }
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
