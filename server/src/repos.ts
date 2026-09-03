// The repository registry: every repository the app or the skill has seen, with what was known
// about it at the time. It answers for a folder that has since been deleted or moved: which
// GitHub repository it was, its first commit, and where its record lives. Both the app (on every
// index pass) and the skill (when it writes agenttrace.json, through register.mjs) write to it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface RepoEntry {
  /** absolute path of the working copy as last seen */
  root: string;
  remote?: string;
  rootCommit?: string;
  /** record folder from agenttrace.json */
  record?: string;
  project?: string;
  /** when the folder was last seen on disk */
  seen: string;
}

export interface Registry {
  version: 1;
  /** keyed by the lower-cased canonical root path */
  repos: Record<string, RepoEntry>;
}

export function registryPath(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'repos.json');
}

/** One spelling per folder: resolved, no trailing slash, lower-cased. Same rule as register.mjs. */
export function keyOf(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

export function loadRegistry(claudeRoot: string): Registry {
  try {
    const raw = JSON.parse(readFileSync(registryPath(claudeRoot), 'utf8'));
    if (raw && raw.version === 1 && raw.repos && typeof raw.repos === 'object') return raw as Registry;
  } catch {
    // no registry yet, or unreadable: start empty and let this pass rebuild what it can
  }
  return { version: 1, repos: {} };
}

export function saveRegistry(claudeRoot: string, reg: Registry): void {
  try {
    const file = registryPath(claudeRoot);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(reg, null, 2));
  } catch {
    // the registry is a memory aid; failing to write it costs nothing until a folder disappears
  }
}

/** Merge what is known now into the entry for this root; fields not given keep their old value. */
export function upsert(reg: Registry, entry: Partial<RepoEntry> & { root: string; seen: string }): RepoEntry {
  const key = keyOf(entry.root);
  const old = reg.repos[key];
  const next: RepoEntry = { ...old, root: entry.root, seen: entry.seen };
  for (const k of ['remote', 'rootCommit', 'record', 'project'] as const) {
    if (entry[k] !== undefined) next[k] = entry[k];
  }
  reg.repos[key] = next;
  return next;
}

/** The registered repository a path is equal to or inside; the deepest one wins when they nest. */
export function lookup(reg: Registry, dir: string): RepoEntry | undefined {
  const k = keyOf(dir);
  let best: RepoEntry | undefined;
  let bestLen = -1;
  for (const [key, e] of Object.entries(reg.repos)) {
    if (key.length <= bestLen) continue;
    if (k === key || k.startsWith(key + '\\') || k.startsWith(key + '/')) {
      best = e;
      bestLen = key.length;
    }
  }
  return best;
}
