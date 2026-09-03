// Every file the coding tool touched has full copies under file-history/<session>/, one per
// version. The transcript's snapshot records say which copy belongs to which path.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Event, TrackedFile } from '@agenttrace/shared';

const BACKUP_NAME = /^[0-9a-f]{16}@v\d+$/;

/** Fold snapshot events into one version list per path, ordered by version. Paths are made absolute from the recorded parent folder. */
export function trackedFiles(events: Event[]): TrackedFile[] {
  const byPath = new Map<string, Map<string, TrackedFile['versions'][number]>>();
  for (const e of events) {
    if (e.kind !== 'snapshot') continue;
    for (const [rawPath, v] of Object.entries(e.files)) {
      if (!BACKUP_NAME.test(v.backup)) continue;
      const path = v.dir ? join(v.dir, basename(rawPath)) : rawPath;
      const m = byPath.get(path) ?? new Map();
      m.set(v.backup, { backup: v.backup, version: v.version, backupTime: v.backupTime });
      byPath.set(path, m);
    }
  }
  return [...byPath.entries()]
    .map(([path, m]) => ({ path, versions: [...m.values()].sort((a, b) => a.version - b.version) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Read one backed-up version. The name is validated so a request cannot reach outside the folder. */
export function readVersion(claudeRoot: string, sessionId: string, backup: string): string | undefined {
  if (!BACKUP_NAME.test(backup)) return undefined;
  const file = join(claudeRoot, 'file-history', sessionId, backup);
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8');
}

/** Read the file as it is on disk now, only if this session tracked that path. */
export function readCurrent(events: Event[], path: string): string | undefined {
  const known = trackedFiles(events).some((f) => f.path === path);
  if (!known || !existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}
