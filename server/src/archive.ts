// The archive: AgentTrace's own copy of every session it has indexed. The coding tool deletes
// transcripts after its retention period (30 days by default); the archive is what makes a
// session outlive that. Copies are made when a session is indexed and refreshed while it grows.
// The same folder keeps each repository's default-branch log, so commits survive a deleted
// working copy the way sessions survive the tool's cleanup.
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
 * Returns true when something was written.
 */
export function archiveSession(claudeRoot: string, s: Pick<Session, 'archived' | 'projectSlug' | 'id'> & Paths): boolean {
  if (s.archived) return false;
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
