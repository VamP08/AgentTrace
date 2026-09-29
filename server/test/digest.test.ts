// The catch-up digest. The order of the edits is the part that matters: they are listed raw and
// chronological, oldest first, and folding them per file is a second list the reader can ask for,
// never the one they get. The rest is joins — commits, helpers, and the record entries whose
// `session:` names this session.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDigest } from '../src/digest.js';
import type { Event, ProjectRecord, Session } from '@agenttrace/shared';

const CWD = '/code/Watcher';
const root = mkdtempSync(join(tmpdir(), 'agenttrace-digest-'));

function snapshot(id: string, ts: string, files: Record<string, { backup: string; version: number; backupTime: string; dir?: string }>): Event {
  return { kind: 'snapshot', id, ts, sessionId: 'sess-1', files };
}

function backup(name: string, bytes: number) {
  writeFileSync(join(root, 'file-history', 'sess-1', name), 'x'.repeat(bytes));
}

mkdirSync(join(root, 'file-history', 'sess-1'), { recursive: true });
backup('aaaaaaaaaaaaaaaa@v1', 100);
backup('aaaaaaaaaaaaaaaa@v2', 260);
backup('bbbbbbbbbbbbbbbb@v1', 50);

const session: Session = {
  id: 'sess-1',
  projectSlug: 'code-Watcher',
  cwd: CWD,
  title: 'Wire up the tailer',
  startedAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T13:00:00.000Z',
  bytes: 1000,
  live: false,
  archived: false,
  file: join(root, 'sess-1.jsonl'),
  dir: join(root, 'sess-1'),
  fileHistory: join(root, 'file-history', 'sess-1'),
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

// tail.ts is edited first and last; parse.ts in between. Snapshot order on the wire is not the
// order of the edits, so the digest has to sort by the backup time and not by arrival.
const events: Event[] = [
  { kind: 'user', id: 'u1', ts: '2026-09-03T10:00:00.000Z', sessionId: 'sess-1', text: 'Write the tailer.\n<system-reminder>ignore me</system-reminder>', images: 0 },
  { kind: 'user', id: 'u2', ts: '2026-09-03T10:05:00.000Z', sessionId: 'sess-1', agentId: 'agent-1', text: 'a subagent brief', images: 0 },
  { kind: 'tool_call', id: 't1', ts: '2026-09-03T10:06:00.000Z', sessionId: 'sess-1', toolUseId: 'tu1', name: 'Write', input: {} },
  { kind: 'tool_result', id: 'r1', ts: '2026-09-03T10:06:01.000Z', sessionId: 'sess-1', toolUseId: 'tu1', content: 'boom', isError: true },
  snapshot('s2', '2026-09-03T11:00:00.000Z', { 'server/src/parse.ts': { backup: 'bbbbbbbbbbbbbbbb@v1', version: 1, backupTime: '2026-09-03T10:30:00.000Z', dir: `${CWD}/server/src` } }),
  snapshot('s1', '2026-09-03T12:00:00.000Z', {
    'server/src/tail.ts': { backup: 'aaaaaaaaaaaaaaaa@v1', version: 1, backupTime: '2026-09-03T10:10:00.000Z', dir: `${CWD}/server/src` },
  }),
  snapshot('s3', '2026-09-03T12:30:00.000Z', {
    'server/src/tail.ts': { backup: 'aaaaaaaaaaaaaaaa@v2', version: 2, backupTime: '2026-09-03T12:00:00.000Z', dir: `${CWD}/server/src` },
  }),
  { kind: 'user', id: 'u3', ts: '2026-09-03T12:40:00.000Z', sessionId: 'sess-1', text: '   <system-reminder>only this</system-reminder>  ', images: 0 },
  // the tool recording that the person pressed stop: not something they asked for
  { kind: 'user', id: 'u4', ts: '2026-09-03T12:41:00.000Z', sessionId: 'sess-1', text: '[Request interrupted by user for tool use]', images: 0 },
  { kind: 'user', id: 'u4', ts: '2026-09-03T12:50:00.000Z', sessionId: 'sess-1', text: '<task-notification>a helper finished</task-notification>', images: 0 },
];

const record: ProjectRecord = {
  project: 'Watcher',
  root: '/records/Watcher',
  repoDir: CWD,
  learning: [
    {
      slug: 'chokidar', title: 'Watching a folder with chokidar', summary: 'Events for files that change', type: 'library', level: 'beginner',
      tags: [], files: [], prerequisites: [], related: [], date: '', updated: '', questions: [], objectives: [], sources: [], cannotFill: {}, body: '', session: 'sess-1',
    },
    {
      slug: 'elsewhere', title: 'Another session wrote this', summary: '', type: 'pattern', level: 'beginner',
      tags: [], files: [], prerequisites: [], related: [], date: '', updated: '', questions: [], objectives: [], sources: [], cannotFill: {}, body: '', session: 'sess-9',
    },
  ],
  decisions: [{ slug: 'poll-on-windows', title: 'Poll on Windows', status: 'accepted', date: '', tags: [], files: [], body: '', session: 'sess-1' }],
  journal: [{ slug: '2026-09-03-1000', date: '2026-09-03', started: '', summary: 'Tailer written', learning: [], decisions: [], commits: [], next: [], body: '', milestone: 'M1', session: 'sess-1' }],
  library: [],
  unparsed: [],
};

const commits = [{ sha: 'a1b2c3d', subject: 'Tail by byte offset', ts: '2026-09-03T12:45:00.000Z', repo: 'Watcher' }];

describe('buildDigest', () => {
  const d = buildDigest(session, events, [{ agentId: 'agent-1', agentType: 'Explore', description: 'find the tailer', toolUseId: 'tu9', spawnDepth: 1, file: 'a.jsonl' }], commits, [record]);

  it('lists one row per version, oldest first, whatever order the snapshots arrived in', () => {
    expect(d.edits.map((e) => `${e.label}@${e.version}`)).toEqual([
      'server/src/tail.ts@1',
      'server/src/parse.ts@1',
      'server/src/tail.ts@2',
    ]);
  });

  it('gives the size of each version and the change since the previous one of that file', () => {
    expect(d.edits.map((e) => e.bytes)).toEqual([100, 50, 260]);
    expect(d.edits.map((e) => e.delta)).toEqual([undefined, undefined, 160]);
  });

  it('labels a path inside the working directory relative to it', () => {
    expect(d.edits[0].label).toBe('server/src/tail.ts');
    // the absolute path keeps whatever separator the platform uses, as the Files view already does
    expect(d.edits[0].path).toBe(join(CWD, 'server', 'src', 'tail.ts'));
  });

  it('falls back to the last three segments for a file written outside the working directory', () => {
    // a session in one repository writing a record kept in another: the absolute path is the same
    // for every row down to its last segment, which is the only part that tells them apart
    const outside = snapshot('s9', '2026-09-03T10:00:00.000Z', {
      'redis.md': { backup: 'bbbbbbbbbbbbbbbb@v1', version: 1, backupTime: '2026-09-03T10:00:00.000Z', dir: '/notes/agenttrace-record/HRMS/learning' },
    });
    const out = buildDigest(session, [outside], [], [], []);
    expect(out.edits[0].label).toBe('…/HRMS/learning/redis.md');
  });

  it('offers the folded view as a second list, one row per file, first touch first', () => {
    expect(d.files.map((f) => [f.label, f.edits, f.delta])).toEqual([
      ['server/src/tail.ts', 2, 160],
      ['server/src/parse.ts', 1, 0],
    ]);
    expect(d.files[0].first).toBe('2026-09-03T10:10:00.000Z');
    expect(d.files[0].last).toBe('2026-09-03T12:00:00.000Z');
  });

  it('keeps the reader’s own words and drops what the tool injected around and instead of them', () => {
    // u2 is a subagent's, u3 is a bare reminder, u4 is a notification the tool wrote: none was asked for
    expect(d.asked).toEqual(['Write the tailer.']);
  });

  it('joins the record entries whose session names this session, and no others', () => {
    expect(d.wrote.map((w) => `${w.kind}:${w.id}`)).toEqual(['lesson:chokidar', 'decision:poll-on-windows', 'journal:2026-09-03-1000']);
  });

  it('counts what a reader would count', () => {
    // turns counts things a person asked for, so the reminder and the notification are not turns
    expect(d.counts).toEqual({ turns: 1, calls: 1, failed: 1, files: 2, edits: 3 });
  });

  it('carries the commits and the helpers through', () => {
    expect(d.commits[0].subject).toBe('Tail by byte offset');
    expect(d.helpers).toEqual([{ agentType: 'Explore', description: 'find the tailer' }]);
  });

  it('says what is absent rather than showing a thin digest as a quiet session', () => {
    const bare = buildDigest(session, [], [], [], []);
    expect(bare.missing).toHaveLength(3);
    expect(bare.missing.join(' ')).toContain('keeps no record');
    expect(d.missing).toHaveLength(0);
  });
});
