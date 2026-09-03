import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveSession, archiveStats } from '../src/archive.js';
import { discoverAgents, discoverSessions, findSession } from '../src/discover.js';

const id = '11111111-2222-3333-4444-555555555555';
const line = (i: number) => JSON.stringify({ type: 'user', cwd: 'e:\Work\demo', timestamp: `2026-09-03T01:00:0${i}.000Z`, message: { role: 'user', content: `turn ${i}` } }) + '\n';

describe('archive', () => {
  it('copies an indexed session and serves it after the original is deleted', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-archive-'));
    const live = join(root, 'projects', 'e--Work-demo');
    mkdirSync(join(live, id, 'subagents'), { recursive: true });
    mkdirSync(join(root, 'file-history', id), { recursive: true });
    writeFileSync(join(live, `${id}.jsonl`), line(1));
    writeFileSync(join(live, id, 'subagents', 'agent-abc.jsonl'), '{}\n');
    writeFileSync(join(live, id, 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 't1' }));
    writeFileSync(join(root, 'file-history', id, '0123456789abcdef@v1'), 'old');

    const s = findSession(root, id)!;
    expect(s.archived).toBe(false);
    expect(archiveSession(root, s)).toBe(true);
    expect(archiveSession(root, s)).toBe(false); // nothing changed since

    // the transcript grows: the copy catches up
    appendFileSync(join(live, `${id}.jsonl`), line(2));
    expect(archiveSession(root, findSession(root, id)!)).toBe(true);

    // the coding tool cleans up; AgentTrace still lists and reads the session from its own copy
    rmSync(live, { recursive: true });
    rmSync(join(root, 'file-history'), { recursive: true });
    const gone = discoverSessions(root);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ id, archived: true, title: 'turn 1', cwd: 'e:\Work\demo' });
    expect(gone[0].file).toBe(join(root, 'agenttrace', 'archive', 'projects', 'e--Work-demo', `${id}.jsonl`));
    expect(existsSync(join(gone[0].fileHistory, '0123456789abcdef@v1'))).toBe(true);
    expect(discoverAgents(gone[0].dir).map((a) => a.agentType)).toEqual(['Explore']);
    expect(archiveSession(root, gone[0])).toBe(false); // an archived copy is never copied onto itself
    expect(archiveStats(root)).toMatchObject({ sessions: 1 });
  });
});
