import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents, discoverSessions } from '../src/discover.js';

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'at-root-'));
  const proj = join(root, 'projects', 'e--Work-demo');
  mkdirSync(proj, { recursive: true });
  const id = '11111111-2222-3333-4444-555555555555';
  const lines = [
    JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-09-03T01:00:00.000Z', cwd: 'e:\\Work\\demo', sessionId: id, message: { role: 'user', content: 'build me a thing' } }),
    JSON.stringify({ type: 'ai-title', sessionId: id, aiTitle: 'Build a thing' }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-09-03T01:00:05.000Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_9', name: 'Agent', input: { prompt: 'go' } }], usage: {} } }),
  ];
  writeFileSync(join(proj, `${id}.jsonl`), lines.join('\n') + '\n');
  const sub = join(proj, id, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-abc123.jsonl'), '{"type":"user","isSidechain":true,"message":{"role":"user","content":"go"}}\n');
  writeFileSync(join(sub, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Look', toolUseId: 'toolu_9', spawnDepth: 1 }));
  // a stray non-transcript file must be ignored
  writeFileSync(join(proj, 'notes.txt'), 'x');
  return { root, id };
}

describe('discoverSessions', () => {
  it('lists sessions with title, cwd, start time and live flag', () => {
    const { root, id } = fakeRoot();
    const [s] = discoverSessions(root);
    expect(s).toMatchObject({ id, projectSlug: 'e--Work-demo', cwd: 'e:\\Work\\demo', title: 'Build a thing', startedAt: '2026-09-03T01:00:00.000Z', live: true, archived: false });
    expect(s.file).toBe(join(root, 'projects', 'e--Work-demo', `${id}.jsonl`));
    expect(s.dir).toBe(join(root, 'projects', 'e--Work-demo', id));
    expect(s.bytes).toBeGreaterThan(0);
  });
  it('returns nothing for a root without projects', () => {
    expect(discoverSessions(join(tmpdir(), 'does-not-exist'))).toEqual([]);
  });
});

describe('discoverAgents', () => {
  it('joins agent transcripts to their meta', () => {
    const { root, id } = fakeRoot();
    const agents = discoverAgents(join(root, 'projects', 'e--Work-demo', id));
    expect(agents).toEqual([
      { agentId: 'abc123', agentType: 'Explore', description: 'Look', toolUseId: 'toolu_9', spawnDepth: 1, file: 'subagents/agent-abc123.jsonl' },
    ]);
  });
});
