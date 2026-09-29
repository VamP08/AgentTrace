import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event } from '@agenttrace/shared';
import { readCurrent, readVersion, trackedFiles } from '../src/fileHistory.js';
import { parseLine } from '../src/parse.js';

const base = { ts: 't', sessionId: 'S' };
const snap = (id: string, files: Record<string, [string, number]>): Event => ({
  ...base, kind: 'snapshot', id,
  files: Object.fromEntries(Object.entries(files).map(([p, [b, v]]) => [p, { backup: b, version: v, backupTime: 'bt' }])),
});

describe('trackedFiles', () => {
  it('merges snapshots into ordered version lists and drops bad backup names', () => {
    const events = [
      snap('s1', { 'C:\\p\\a.ts': ['0123456789abcdef@v1', 1] }),
      snap('s2', { 'C:\\p\\a.ts': ['0123456789abcdef@v2', 2], 'C:\\p\\b.ts': ['fedcba9876543210@v1', 1] }),
      snap('s3', { 'C:\\p\\a.ts': ['0123456789abcdef@v1', 1], 'C:\\p\\old.ts': ['null', 0] }),
    ];
    expect(trackedFiles(events)).toEqual([
      { path: 'C:\\p\\a.ts', versions: [{ backup: '0123456789abcdef@v1', version: 1, backupTime: 'bt' }, { backup: '0123456789abcdef@v2', version: 2, backupTime: 'bt' }] },
      { path: 'C:\\p\\b.ts', versions: [{ backup: 'fedcba9876543210@v1', version: 1, backupTime: 'bt' }] },
    ]);
  });
  it('resolves a cwd-relative path through the recorded parent folder', () => {
    const dir = join(tmpdir(), 'Project', 'AgentTrace');
    const e: Event = { ...base, kind: 'snapshot', id: 'r', files: { [join('AgentTrace', '.gitignore')]: { backup: '729c6c8f7ee7df73@v2', version: 2, backupTime: 'bt', dir } } };
    expect(trackedFiles([e])[0].path).toBe(join(dir, '.gitignore'));
  });
  it('resolves a relative path with no recorded folder against the session folder, never the server folder', () => {
    const rel = join('doc2agent', 'app', 'main.py');
    const cwd = join(tmpdir(), 'Project');
    const e: Event = { ...base, kind: 'snapshot', id: 'r2', files: { [rel]: { backup: '729c6c8f7ee7df73@v2', version: 2, backupTime: 'bt' } } };
    expect(trackedFiles([e], cwd)[0].path).toBe(join(cwd, rel));
    expect(trackedFiles([e])[0].path).toBe(rel);
  });
  it('file-history-delta records parse into single-file snapshots', () => {
    const line = JSON.stringify({ type: 'file-history-delta', uuid: 'd1', trackingPath: 'C:\\p\\a.ts', backup: { backupFileName: '0123456789abcdef@v3', version: 3, backupTime: 'bt' } });
    const [e] = parseLine(line, { sessionId: 'S' });
    expect(e).toMatchObject({ kind: 'snapshot', files: { 'C:\\p\\a.ts': { backup: '0123456789abcdef@v3', version: 3 } } });
  });
});

describe('readVersion / readCurrent', () => {
  it('reads a backup by validated name and refuses anything else', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-fh-'));
    mkdirSync(join(root, 'file-history', 'S'), { recursive: true });
    writeFileSync(join(root, 'file-history', 'S', '0123456789abcdef@v1'), 'old text');
    const fh = join(root, 'file-history', 'S');
    expect(readVersion(fh, '0123456789abcdef@v1')).toBe('old text');
    expect(readVersion(fh, '../../settings.json')).toBeUndefined();
    expect(readVersion(fh, '0123456789abcdef@v9')).toBeUndefined();
  });
  it('reads the live file only when the session tracked it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-cur-'));
    const tracked = join(dir, 'a.ts');
    const other = join(dir, 'secret.txt');
    writeFileSync(tracked, 'now');
    writeFileSync(other, 'no');
    const events = [snap('s1', { [tracked]: ['0123456789abcdef@v1', 1] })];
    expect(readCurrent(events, tracked)).toBe('now');
    expect(readCurrent(events, other)).toBeUndefined();
  });
});
