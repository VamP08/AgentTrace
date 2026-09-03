import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitsBetween, showCommit } from '../src/git.js';
import { parseHookLog } from '../src/hooks.js';

describe('parseHookLog', () => {
  it('keeps durations by tool id, counts events, and skips junk', () => {
    const lines = [
      JSON.stringify({ hook_event_name: 'SessionStart', received_at: '2026-09-03T05:00:00Z' }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', received_at: '2026-09-03T05:00:01Z' }),
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', duration_ms: 1234, received_at: '2026-09-03T05:00:03Z' }),
      JSON.stringify({ hook_event_name: 'Notification', message: 'Claude needs your permission', received_at: '2026-09-03T05:00:04Z' }),
      JSON.stringify({ hook_event_name: 'SomethingElse' }),
      'not json',
      JSON.stringify({ hook_event_name: 'SessionEnd', received_at: '2026-09-03T05:10:00Z' }),
    ].join('\n');
    const s = parseHookLog(lines);
    expect(s.durations).toEqual({ toolu_1: 1234 });
    expect(s.counts).toEqual({ SessionStart: 1, PreToolUse: 1, PostToolUse: 1, Notification: 1, SessionEnd: 1 });
    expect(s.events.find((e) => e.event === 'Notification')?.note).toBe('Claude needs your permission');
    expect(s.sessionStart).toBe('2026-09-03T05:00:00Z');
    expect(s.sessionEnd).toBe('2026-09-03T05:10:00Z');
  });
});

describe('git', () => {
  it('lists commits in a window with file stats, and shows one', () => {
    const repo = mkdtempSync(join(tmpdir(), 'at-git-'));
    const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-03T05:05:00Z', GIT_COMMITTER_DATE: '2026-09-03T05:05:00Z' } });
    g('init', '-q');
    g('config', 'user.email', 'a@b.c');
    g('config', 'user.name', 'a');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    g('add', 'a.txt');
    g('commit', '-q', '-m', 'first');
    const commits = commitsBetween(repo, '2026-09-03T05:00:00Z', '2026-09-03T05:10:00Z');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ subject: 'first', files: [{ path: 'a.txt', added: 2, removed: 0 }] });
    expect(showCommit(repo, commits[0].sha)).toContain('+one');
    expect(showCommit(repo, '../../etc')).toBeUndefined();
    expect(commits[0].merged).toBe(true);
    // a commit on a side branch that never reached main is listed, marked as not merged
    g('checkout', '-q', '-b', 'side');
    writeFileSync(join(repo, 'b.txt'), 'side\n');
    g('add', 'b.txt');
    g('commit', '-q', '-m', 'on a branch');
    g('checkout', '-q', '-');
    const withBranch = commitsBetween(repo, '2026-09-03T05:00:00Z', '2026-09-03T05:10:00Z');
    expect(withBranch.map((c) => [c.subject, c.merged]).sort()).toEqual([['first', true], ['on a branch', false]]);
    expect(commitsBetween(repo, '2026-09-04T00:00:00Z', '2026-09-05T00:00:00Z')).toEqual([]);
    expect(commitsBetween(tmpdir(), '2026-09-03T05:00:00Z', '2026-09-03T05:10:00Z')).toEqual([]);
  });
});
