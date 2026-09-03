import { describe, expect, it } from 'vitest';
import type { Event, Session } from '@agenttrace/shared';
import { commitsMade, sessionFacts } from '../src/projects.js';

const session = (id: string, cwd: string): Session => ({ id, projectSlug: 'slug', cwd, title: id, startedAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T12:00:00Z', bytes: 10, live: false });

describe('commitsMade', () => {
  it('lists the hashes git printed for commits made through the shell, and the facts carry them', () => {
    const events: Event[] = [
      { kind: 'tool_call', id: 'b1', ts: 't1', sessionId: 's1', toolUseId: 'b1', name: 'Bash', input: { command: 'git add -A && git commit -m "x"' }, cwd: 'E:\\r\\hrms' },
      { kind: 'tool_result', id: 'b1:r', ts: 't2', sessionId: 's1', toolUseId: 'b1', content: '[main 1a2b3c4] x\n 2 files changed', isError: false },
      { kind: 'tool_call', id: 'b2', ts: 't3', sessionId: 's1', toolUseId: 'b2', name: 'Bash', input: { command: 'git commit -m "y"' } },
      { kind: 'tool_result', id: 'b2:r', ts: 't4', sessionId: 's1', toolUseId: 'b2', content: 'nothing to commit, working tree clean', isError: true },
      { kind: 'tool_call', id: 'b3', ts: 't5', sessionId: 's1', toolUseId: 'b3', name: 'Bash', input: { command: 'git log --oneline' } },
      { kind: 'tool_result', id: 'b3:r', ts: 't6', sessionId: 's1', toolUseId: 'b3', content: '[main 9999999] not a commit being made', isError: false },
    ];
    expect(commitsMade(events, session('s1', 'E:\\r\\hrms'))).toEqual([{ sha: '1a2b3c4', cwd: 'E:\\r\\hrms' }]);
    expect(sessionFacts(events, session('s1', 'E:\\r\\hrms'), []).commits).toEqual(['1a2b3c4']);
  });

  it('takes the first line of a git log that follows a quiet commit in the same command', () => {
    const events: Event[] = [
      { kind: 'tool_call', id: 'b1', ts: 't1', sessionId: 's1', toolUseId: 'b1', name: 'Bash', input: { command: "git commit -q -F - <<'MSG' && git log --oneline -2\nfix: x\nMSG" } },
      { kind: 'tool_result', id: 'b1:r', ts: 't2', sessionId: 's1', toolUseId: 'b1', content: 'abc1234 fix: x\n9999999 older', isError: false },
      { kind: 'tool_call', id: 'b2', ts: 't3', sessionId: 's1', toolUseId: 'b2', name: 'Bash', input: { command: 'git commit -q -m y' } },
      { kind: 'tool_result', id: 'b2:r', ts: 't4', sessionId: 's1', toolUseId: 'b2', content: '', isError: false },
    ];
    expect(commitsMade(events, session('s1', 'E:\\r')).map((c) => c.sha)).toEqual(['abc1234']);
  });
});
