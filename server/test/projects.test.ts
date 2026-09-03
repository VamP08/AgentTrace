import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Event, Session } from '@agenttrace/shared';
import { foldProjects, githubId, sessionFacts } from '../src/projects.js';

const session = (id: string, cwd: string, live = false): Session => ({
  id, projectSlug: 'slug', cwd, title: id, startedAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T12:00:00Z', bytes: 10, live,
});
const user = (id: string, ts: string, text: string): Event => ({ kind: 'user', id, ts, sessionId: 's1', text, images: 0 });
const write = (id: string, ts: string, file: string, cwd?: string): Event => ({ kind: 'tool_call', id, ts, sessionId: 's1', toolUseId: id, name: 'Write', input: { file_path: file, content: 'x' }, cwd });
const fail = (id: string): Event => ({ kind: 'tool_result', id: `${id}:r`, ts: 't', sessionId: 's1', toolUseId: id, content: 'boom', isError: true });

describe('githubId', () => {
  it('normalises every way a GitHub remote is written and ignores other hosts', () => {
    expect(githubId('https://github.com/VamP08/HRMS.git')).toBe('github.com/vamp08/hrms');
    expect(githubId('git@github.com:VamP08/HRMS.git')).toBe('github.com/vamp08/hrms');
    expect(githubId('ssh://git@github.com/VamP08/HRMS')).toBe('github.com/vamp08/hrms');
    expect(githubId('https://gitlab.com/a/b.git')).toBeUndefined();
    expect(githubId(undefined)).toBeUndefined();
  });
});

describe('sessionFacts', () => {
  // The test folders are not repositories, so edits outside any repository are dropped and the
  // record-folder rule is what attributes; that is the path the real join takes for notes.
  it('counts edits in record folders for the project that owns them, and counts calls and failures', () => {
    const manifests = [{ repoDir: join('E:', 'work', 'hrms'), root: join('E:', 'work', 'docs', 'HRMS') }];
    const events = [user('u1', 't1', 'note it'), write('w1', 't2', join('E:', 'work', 'docs', 'HRMS', 'learning', 'x.md')), fail('w1'), write('w2', 't3', join('E:', 'nowhere', 'a.txt'))];
    const f = sessionFacts(events, session('s1', join('E:', 'work')), manifests);
    expect(f.calls).toBe(2);
    expect(f.failed).toBe(1);
    expect(Object.keys(f.edits)).toHaveLength(1);
    expect(f.edits[Object.keys(f.edits)[0]]).toBe(1);
  });
  it('resolves a relative path against the line\'s own working directory, not the session start', () => {
    const manifests = [{ repoDir: join('E:', 'work', 'hrms'), root: join('E:', 'work', 'docs', 'HRMS') }];
    const events = [user('u1', 't1', 'go'), write('w1', 't2', join('HRMS', 'x.md'), join('E:', 'work', 'docs'))];
    const f = sessionFacts(events, session('s1', join('E:', 'elsewhere')), manifests);
    expect(Object.keys(f.edits)).toHaveLength(1);
  });
});

describe('foldProjects', () => {
  const base = { bytes: 1, updatedAt: 'u', calls: 1, failed: 0, startTs: '2026-09-03T10:00:00Z', endTs: '2026-09-03T11:00:00Z', cwdRepo: null };
  it('lists a session under every repository it edited, marks the biggest as primary, and sends the rest to misc', () => {
    const facts = new Map([
      ['s1', { ...base, edits: { [join('E:', 'r', 'hrms')]: 5, [join('E:', 'r', 'docs')]: 2 } }],
      ['s2', { ...base, edits: {}, cwdRepo: join('E:', 'r', 'hrms') }],
      ['s3', { ...base, edits: {}, cwdRepo: null }],
    ]);
    const sessions = new Map([['s1', session('s1', 'E:\\r\\hrms')], ['s2', session('s2', 'E:\\r\\hrms', true)], ['s3', session('s3', 'E:\\web\\previews')]]);
    const { projects, misc } = foldProjects(facts, sessions);
    const hrms = projects.find((p) => p.root === join('E:', 'r', 'hrms'))!;
    expect(hrms.sessions.map((l) => [l.sessionId, l.primary, l.byCwdOnly])).toEqual([['s1', true, false], ['s2', true, true]]);
    expect(hrms.live).toBe(true);
    const docs = projects.find((p) => p.root === join('E:', 'r', 'docs'))!;
    expect(docs.sessions).toEqual([{ sessionId: 's1', edits: 2, primary: false, byCwdOnly: false }]);
    expect(misc).toEqual([{ sessionId: 's3', folder: 'previews' }]);
    // no remote on these test paths, so both are local repositories, not GitHub ones
    expect(projects.every((p) => p.kind === 'local')).toBe(true);
  });
});
