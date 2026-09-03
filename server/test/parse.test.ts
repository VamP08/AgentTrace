import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile, parseLine } from '../src/parse.js';

const ctx = { sessionId: 'S1' };
const line = (o: unknown) => JSON.stringify(o);

// Shapes below mirror real transcript records, trimmed to the fields the parser reads.
const userText = line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: 't1', sessionId: 'S1', message: { role: 'user', content: 'hello' } });
const userImage = line({ type: 'user', uuid: 'u2', timestamp: 't2', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'see this' }] } });
const toolResult = line({ type: 'user', uuid: 'u3', timestamp: 't3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill', is_error: false }] } });
const assistant = line({
  type: 'assistant', uuid: 'a1', timestamp: 't4', parentUuid: 'u1',
  message: { id: 'msg_1', model: 'm', role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'x' } }], usage: { input_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 20, output_tokens: 5 } },
});
const agentCall = line({ type: 'assistant', uuid: 'a2', timestamp: 't5', message: { id: 'msg_2', model: 'm', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Sweep', prompt: 'Find all the things' } }], usage: { input_tokens: 1, output_tokens: 1 } } });
const attachment = line({ type: 'attachment', uuid: 'at1', timestamp: 't6', attachment: { type: 'hook_success', hookName: 'SessionStart:startup', content: 'MODE ACTIVE' } });
const snapshot = line({ type: 'file-history-snapshot', messageId: 'm9', snapshot: { messageId: 'm9', trackedFileBackups: { 'C:\\p\\a.md': { backupFileName: 'abc@v2', version: 2, backupTime: 'bt' }, 'C:\\p\\old.md': { backupFileName: null } } } });
const title = line({ type: 'ai-title', sessionId: 'S1', aiTitle: 'A session' });
const compact = line({ type: 'user', uuid: 'u4', timestamp: 't7', isCompactSummary: true, message: { role: 'user', content: 'Summary of earlier work' } });

describe('parseLine', () => {
  it('user text', () => {
    const [e] = parseLine(userText, ctx);
    expect(e).toMatchObject({ kind: 'user', id: 'u1', ts: 't1', text: 'hello', images: 0, sessionId: 'S1' });
  });
  it('strips images and counts them', () => {
    const [e] = parseLine(userImage, ctx);
    expect(e).toMatchObject({ kind: 'user', text: 'see this', images: 1 });
    expect(JSON.stringify(e)).not.toContain('AAAA');
  });
  it('tool_result inside a user record', () => {
    const [e] = parseLine(toolResult, ctx);
    expect(e).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_1', content: 'Launching skill', isError: false });
  });
  it('assistant text, tool_use, usage; thinking dropped', () => {
    const evs = parseLine(assistant, ctx);
    expect(evs.map((e) => e.kind)).toEqual(['assistant_text', 'tool_call', 'usage']);
    expect(evs[1]).toMatchObject({ toolUseId: 'toolu_1', name: 'Skill', input: { skill: 'x' } });
    expect(evs[2]).toMatchObject({ id: 'msg_1:usage', input: 2, cacheWrite: 30, cacheRead: 20, output: 5 });
  });
  it('Agent tool_use also yields agent_spawn with the brief', () => {
    const evs = parseLine(agentCall, ctx);
    expect(evs.map((e) => e.kind)).toEqual(['tool_call', 'agent_spawn', 'usage']);
    expect(evs[1]).toMatchObject({ toolUseId: 'toolu_2', agentType: 'Explore', description: 'Sweep', brief: 'Find all the things' });
  });
  it('attachment becomes context', () => {
    const [e] = parseLine(attachment, ctx);
    expect(e).toMatchObject({ kind: 'context', source: 'hook_success:SessionStart:startup', content: 'MODE ACTIVE' });
  });
  it('snapshot keeps only entries with a backup name', () => {
    const [e] = parseLine(snapshot, ctx);
    expect(e).toMatchObject({ kind: 'snapshot', files: { 'C:\\p\\a.md': { backup: 'abc@v2', version: 2 } } });
    expect((e as any).files['C:\\p\\old.md']).toBeUndefined();
  });
  it('unknown types stay as raw with whitelisted data', () => {
    const [e] = parseLine(title, ctx);
    expect(e).toMatchObject({ kind: 'raw', type: 'ai-title', data: { aiTitle: 'A session' } });
  });
  it('compact summary becomes context', () => {
    const [e] = parseLine(compact, ctx);
    expect(e).toMatchObject({ kind: 'context', source: 'compact_summary' });
  });
  it('bad json never throws', () => {
    const [e] = parseLine('{not json', ctx);
    expect(e).toMatchObject({ kind: 'raw', type: 'parse_error' });
    expect(parseLine('   ', ctx)).toEqual([]);
  });
  it('agentId from context applies to subagent lines', () => {
    const [e] = parseLine(userText, { sessionId: 'S1', agentId: 'ag1' });
    expect(e.agentId).toBe('ag1');
  });
});

describe('parseFile', () => {
  it('streams a file and counts parse errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-'));
    const f = join(dir, 's.jsonl');
    writeFileSync(f, [userText, assistant, '{broken', title, ''].join('\n'));
    const r = await parseFile(f, ctx);
    expect(r.parseErrors).toBe(1);
    expect(r.events.map((e) => e.kind)).toEqual(['user', 'assistant_text', 'tool_call', 'usage', 'raw', 'raw']);
  });
});
