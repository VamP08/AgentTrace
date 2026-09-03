// The archive: AgentTrace's own copy of every session it has indexed. The coding tool deletes
// transcripts after its retention period (30 days by default); the archive is what makes a
// session outlive that. Copies are made when a session is indexed and refreshed while it grows.
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Session } from '@agenttrace/shared';

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
