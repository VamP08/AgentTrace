import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { archivePaths, archiveSession, archiveStats, livePaths, loadPruned, loadSettings, pruneArchive, saveSettings, settingsPath } from '../src/archive.js';

const SLUG = 'e--Work-demo';
const KB = 200;
const AGENT = '{}\n';
const HISTORY = 'old';
/** what one seeded session takes in the archive: transcript, one subagent file, one file-history entry */
const EACH = KB * 1024 + AGENT.length + HISTORY.length;

const OLD = new Date('2026-01-01T00:00:00Z');
const MIDDLE = new Date('2026-02-01T00:00:00Z');
const NEW = new Date('2026-03-01T00:00:00Z');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

/** An archived session, with the live original beside it or without. */
function seed(root: string, id: string, when: Date, live: boolean) {
  const body = 'x'.repeat(KB * 1024);
  const a = archivePaths(root, SLUG, id);
  mkdirSync(dirname(a.file), { recursive: true });
  writeFileSync(a.file, body);
  mkdirSync(join(a.dir, 'subagents'), { recursive: true });
  writeFileSync(join(a.dir, 'subagents', 'agent-abc.jsonl'), AGENT);
  mkdirSync(a.fileHistory, { recursive: true });
  writeFileSync(join(a.fileHistory, '0123456789abcdef@v1'), HISTORY);
  utimesSync(a.file, when, when);
  if (!live) return;
  const l = livePaths(root, SLUG, id);
  mkdirSync(dirname(l.file), { recursive: true });
  writeFileSync(l.file, body);
  utimesSync(l.file, when, when);
}

function gone(root: string, id: string): boolean {
  const a = archivePaths(root, SLUG, id);
  return !existsSync(a.file) && !existsSync(a.dir) && !existsSync(a.fileHistory);
}

/** Three sessions of the same size: the oldest and the newest have live originals, the middle one does not. */
function fabricate(): { root: string; total: number; gitLog: string } {
  const root = mkdtempSync(join(tmpdir(), 'at-prune-'));
  seed(root, A, OLD, true);
  seed(root, C, MIDDLE, false);
  seed(root, B, NEW, true);
  const gitLog = join(root, 'agenttrace', 'archive', 'git', 'demo.json');
  mkdirSync(dirname(gitLog), { recursive: true });
  writeFileSync(gitLog, JSON.stringify({ commits: [] }));
  return { root, total: archiveStats(root).bytes, gitLog };
}

describe('pruneArchive', () => {
  it('does nothing while the archive fits under the cap', () => {
    const { root, total } = fabricate();
    expect(pruneArchive(root, total)).toMatchObject({ removed: [], bytes: total, cap: total, keptOnlyCopies: 0 });
    expect(archiveStats(root).sessions).toBe(3);
  });

  it('removes the oldest session that still has a live original, and stops at the cap', () => {
    const { root, total, gitLog } = fabricate();
    const result = pruneArchive(root, total - EACH);

    expect(result.removed).toEqual([{ id: A, bytes: EACH }]);
    expect(result.bytes).toBe(total - EACH);
    expect(result.keptOnlyCopies).toBe(0);
    expect(gone(root, A)).toBe(true);
    expect(gone(root, B)).toBe(false);
    expect(gone(root, C)).toBe(false);
    expect(existsSync(gitLog)).toBe(true);
    expect(archiveStats(root).sessions).toBe(2);
  });

  it('keeps the sessions it holds the only copy of, and reports how far over it stays', () => {
    const { root, total, gitLog } = fabricate();
    const result = pruneArchive(root, 1);

    expect(result.removed.map((r) => r.id)).toEqual([A, B]);
    expect(result.keptOnlyCopies).toBe(1);
    expect(result.bytes).toBe(total - 2 * EACH);
    expect(result.bytes).toBeGreaterThan(result.cap);
    // the only copy of C, and the commit log, survive a cap that cannot be met
    expect(gone(root, C)).toBe(false);
    expect(existsSync(archivePaths(root, SLUG, C).fileHistory)).toBe(true);
    expect(existsSync(gitLog)).toBe(true);
  });

  it('stops copying a pruned session back in until the limit is raised', () => {
    const { root, total } = fabricate();
    const live = { archived: false, projectSlug: SLUG, id: A, ...livePaths(root, SLUG, A) };

    saveSettings(root, { archiveCapBytes: total - EACH });
    expect(pruneArchive(root, total - EACH).removed.map((r) => r.id)).toEqual([A]);
    expect([...loadPruned(root)]).toEqual([A]);

    // the original is still on disk, but the next pass leaves it alone
    expect(existsSync(live.file)).toBe(true);
    expect(archiveSession(root, live)).toBe(false);
    expect(existsSync(archivePaths(root, SLUG, A).file)).toBe(false);

    // more room: the list is cleared and the session is copied again
    saveSettings(root, { archiveCapBytes: total });
    expect([...loadPruned(root)]).toEqual([]);
    expect(archiveSession(root, live)).toBe(true);
    expect(existsSync(archivePaths(root, SLUG, A).file)).toBe(true);
  });
});

describe('loadSettings', () => {
  it('falls back to no cap when the file is missing, broken or out of range', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-settings-'));
    expect(loadSettings(root)).toEqual({ archiveCapBytes: null });

    mkdirSync(dirname(settingsPath(root)), { recursive: true });
    writeFileSync(settingsPath(root), '{ "archiveCapBytes": ');
    expect(loadSettings(root)).toEqual({ archiveCapBytes: null });

    writeFileSync(settingsPath(root), JSON.stringify({ archiveCapBytes: 'lots' }));
    expect(loadSettings(root)).toEqual({ archiveCapBytes: null });

    writeFileSync(settingsPath(root), JSON.stringify({ archiveCapBytes: 5 }));
    expect(loadSettings(root)).toEqual({ archiveCapBytes: null });

    saveSettings(root, { archiveCapBytes: 5e9 });
    expect(loadSettings(root)).toEqual({ archiveCapBytes: 5e9 });

    saveSettings(root, { archiveCapBytes: null });
    expect(loadSettings(root)).toEqual({ archiveCapBytes: null });
  });
});
