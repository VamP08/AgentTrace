import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event, Session } from '@agenttrace/shared';
import { foldProjects, turnsOf } from '../src/projects.js';

const session = (id: string, cwd: string, live = false): Session => ({
  id, projectSlug: 'slug', cwd, title: id, startedAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T12:00:00Z', bytes: 10, live,
});

const user = (id: string, ts: string, text: string): Event => ({ kind: 'user', id, ts, sessionId: 's1', text, images: 0 });
const write = (id: string, ts: string, file: string): Event => ({ kind: 'tool_call', id, ts, sessionId: 's1', toolUseId: id, name: 'Write', input: { file_path: file, content: 'x' } });
const bash = (id: string, ts: string): Event => ({ kind: 'tool_call', id, ts, sessionId: 's1', toolUseId: id, name: 'Bash', input: { command: 'ls' } });

describe('turnsOf', () => {
  const cwd = 'E:\\Work\\demo';
  // No real repositories in the test, so each file's own folder stands in for a repository root.
  it('splits at each prompt and counts edits per folder', () => {
    const events = [
      user('u1', 't1', 'first ask\nsecond line'),
      write('w1', 't2', 'E:\\Work\\demo\\hrms\\a.ts'),
      write('w2', 't3', 'E:\\Work\\demo\\hrms\\b.ts'),
      bash('b1', 't4'),
      user('u2', 't5', 'second ask'),
      write('w3', 't6', 'E:\\Work\\demo\\other\\c.ts'),
    ];
    const turns = turnsOf(events, session('s1', cwd), []);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ n: 1, prompt: 'first ask', calls: 3 });
    expect(turns[0].edits['E:\\Work\\demo\\hrms']).toBe(2);
    expect(turns[1].edits['E:\\Work\\demo\\other']).toBe(1);
  });

  it('attributes a record folder to the project it documents, not to the folder that holds it', () => {
    const manifests = [{ repoDir: 'E:\\Work\\demo\\hrms', root: 'E:\\Work\\demo\\docs\\HRMS' }];
    const events = [user('u1', 't1', 'note it'), write('w1', 't2', 'E:\\Work\\demo\\docs\\HRMS\\learning\\x.md')];
    const [turn] = turnsOf(events, session('s1', cwd), manifests);
    expect(Object.keys(turn.edits)).toEqual(['E:\\Work\\demo\\hrms']);
  });

  it('resolves a relative path against the session folder', () => {
    const events = [user('u1', 't1', 'go'), write('w1', 't2', 'hrms\\a.ts')];
    const [turn] = turnsOf(events, session('s1', cwd), []);
    expect(turn.edits['E:\\Work\\demo\\hrms']).toBe(1);
  });
});

describe('foldProjects', () => {
  it('counts a turn in every project it edited and skips turns that wrote nothing', () => {
    const turns = [
      { sessionId: 's1', n: 1, prompt: 'a', startTs: '2026-09-03T10:00:00Z', endTs: '2026-09-03T10:05:00Z', calls: 3, failed: 1, edits: { 'E:\\hrms': 4, 'E:\\portfolio': 1 }, also: [] },
      { sessionId: 's2', n: 1, prompt: 'b', startTs: '2026-09-03T11:00:00Z', endTs: '2026-09-03T11:30:00Z', calls: 2, failed: 0, edits: { 'E:\\hrms': 2 }, also: [] },
      { sessionId: 's2', n: 2, prompt: 'c', startTs: '2026-09-03T12:00:00Z', endTs: '2026-09-03T12:01:00Z', calls: 1, failed: 0, edits: {}, also: [] },
    ];
    const sessions = new Map([['s1', session('s1', 'E:\\hrms')], ['s2', session('s2', 'E:\\hrms', true)]]);
    const projects = foldProjects(turns, sessions);
    const hrms = projects.find((p) => p.root === 'E:\\hrms')!;
    expect(hrms).toMatchObject({ name: 'hrms', turns: 2, calls: 5, failed: 1, live: true, kind: 'folder' });
    expect(hrms.sessions.sort()).toEqual(['s1', 's2']);
    expect(hrms.firstTs).toBe('2026-09-03T10:00:00Z');
    expect(hrms.lastTs).toBe('2026-09-03T11:30:00Z');
    const portfolio = projects.find((p) => p.root === 'E:\\portfolio')!;
    expect(portfolio.turns).toBe(1);
    expect(projects.every((p) => p.turns > 0)).toBe(true);
  });

  it('sorts repositories before scratch and config folders', () => {
    const mk = (root: string) => ({ sessionId: 's1', n: 1, prompt: 'p', startTs: 't', endTs: 't', calls: 1, failed: 0, edits: { [root]: 1 }, also: [] });
    const claudeRoot = join('C:', 'Users', 'x', '.claude');
    const turns = [mk(join(tmpdir(), 'claude', 'scratch')), mk(join(claudeRoot, 'plans')), mk(join('E:', 'work', 'thing'))];
    const sessions = new Map([['s1', session('s1', join('E:', 'work'))]]);
    const kinds = foldProjects(turns, sessions, claudeRoot).map((p) => p.kind);
    expect(kinds).toEqual(['folder', 'config', 'scratch']);
  });
});
