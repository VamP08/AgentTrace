// Git history of the folder a session ran in, joined to the session by time. No library: the
// git binary already exists wherever there is a repository. A repository whose folder is gone
// answers from the archived copy of its default-branch log.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { archivedCommits } from './archive.js';
import { canon, repoOf } from './projects.js';

export interface Commit {
  sha: string;
  ts: string;
  subject: string;
  files: { path: string; added: number; removed: number }[];
  /** false when the commit sits on a branch that has not reached the default branch */
  merged: boolean;
}

/** The branch a repository publishes: origin's HEAD when known, else main or master, else HEAD. */
export function defaultBranch(cwd: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim();
    if (ref) return ref;
  } catch {
    // no remote HEAD recorded
  }
  for (const b of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', b], { cwd, encoding: 'utf8', timeout: 5_000, windowsHide: true });
      return b;
    } catch {
      // try the next
    }
  }
  return 'HEAD';
}

const RECORD = '\x1e';
const FIELD = '\x1f';

/**
 * Commits in [since, until], newest first. Empty when the folder is not a repository. When the
 * folder is gone and a claudeRoot is given, the archived log answers instead, default branch only.
 */
export function commitsBetween(cwd: string, since: string, until: string, claudeRoot?: string): Commit[] {
  if (!cwd) return [];
  if (!existsSync(cwd)) {
    const log = claudeRoot ? archivedCommits(claudeRoot, cwd) : undefined;
    if (!log) return [];
    return log.commits
      .filter((c) => c.ts >= since && c.ts <= until)
      .map((c) => ({ sha: c.sha.slice(0, 7), ts: c.ts, subject: c.subject, files: c.files, merged: true }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }
  if (!existsSync(join(cwd, '.git')) && !isInsideRepo(cwd)) return [];
  let out: string;
  try {
    // every local branch and the default branch, so branch work appears and can be marked
    out = execFileSync('git', ['log', '--branches', defaultBranch(cwd), `--since=${since}`, `--until=${until}`, `--format=${RECORD}%h${FIELD}%cI${FIELD}%s`, '--numstat', '--no-merges'], { cwd, encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 50_000_000 });
  } catch {
    return [];
  }
  const commits: Commit[] = [];
  for (const block of out.split(RECORD)) {
    if (!block.trim()) continue;
    const [head, ...rest] = block.trim().split('\n');
    const [sha, ts, subject] = head.split(FIELD);
    if (!sha) continue;
    const files = rest
      .map((l) => l.split('\t'))
      .filter((p) => p.length === 3)
      .map(([a, r, path]) => ({ path, added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r) }));
    commits.push({ sha, ts, subject, files, merged: true });
  }
  // ponytail: one ancestor check per commit; a session window holds tens of commits, not thousands.
  const main = defaultBranch(cwd);
  for (const c of commits) c.merged = isAncestor(cwd, c.sha, main);
  return commits;
}

function isAncestor(cwd: string, sha: string, branch: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, branch], { cwd, encoding: 'utf8', timeout: 5_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every repository a session worked in: its cwd if that is one, plus the repos holding the files
 * it touched, most-touched first. A folder that is gone still names its repository through the
 * registry, so its archived log can answer.
 */
function realOrSame(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

export function gitRootsFor(cwd: string, touched: string[] = []): string[] {
  const candidates = new Map<string, number>();
  candidates.set(cwd, Infinity);
  for (const p of touched) {
    const dir = dirname(p);
    candidates.set(dir, (candidates.get(dir) ?? 0) + 1);
  }
  const roots = new Map<string, number>();
  for (const [dir, n] of [...candidates.entries()].sort((a, b) => b[1] - a[1])) {
    let top: string | null;
    if (!existsSync(dir)) top = repoOf(dir);
    else {
      try {
        top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim();
      } catch {
        continue;
      }
    }
    if (!top) continue;
    // git prints forward slashes, repoOf returns whatever the path was resolved to, and Windows
    // disagrees on case. Two spellings of one repository meant its commits were listed twice.
    // git also prints the real path, through macOS's /var -> /private/var and Windows short names.
    const key = canon(realOrSame(top));
    roots.set(key, (roots.get(key) ?? 0) + (n === Infinity ? 1 : n));
  }
  return [...roots.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

function isInsideRepo(cwd: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim() === 'true';
  } catch {
    return false;
  }
}

/** Unified diff of one commit, capped so a giant commit cannot flood the browser. */
export function showCommit(cwd: string, sha: string, limit = 200_000): string | undefined {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return undefined;
  try {
    const out = execFileSync('git', ['show', '--stat', '--patch', '--no-color', sha], { cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 50_000_000 });
    return out.length > limit ? out.slice(0, limit) + '\n… truncated' : out;
  } catch {
    return undefined;
  }
}
