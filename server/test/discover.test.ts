import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
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

// Every call used to open and read the head and tail of every transcript on the machine — 71 s of a
// 180 s profile over ~2,000 files. An unchanged file is now described once.
describe('discoverSessions cache', () => {
  it('does not re-read a transcript whose size and mtime are unchanged, and does re-read one that grew', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-disc-cache-'));
    const dir = join(root, 'projects', 'slug');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, '99999999-2222-3333-4444-555555555555.jsonl');
    const line = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t }) + '\n';
    const fixed = new Date('2026-09-01T00:00:00.000Z');
    writeFileSync(file, line('Title AAAA'));
    utimesSync(file, fixed, fixed);
    expect(discoverSessions(root)[0].title).toBe('Title AAAA');

    // same length, same mtime: the cached description stands, which proves the file was not read
    writeFileSync(file, line('Title BBBB'));
    utimesSync(file, fixed, fixed);
    expect(discoverSessions(root)[0].title).toBe('Title AAAA');

    // it grows: read again
    appendFileSync(file, line('Title CCCC'));
    const s = discoverSessions(root)[0];
    expect(s.title).toBe('Title CCCC');
    expect(s.live).toBe(true);
  });

  // 2,720 of 2,800 sessions on one machine were a plugin's headless workers, launched through the
  // Agent SDK. The transcript says so in `entrypoint`; a person's session says cli or an editor.
  it('marks a session a program started through the SDK, and not one a person started', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-disc-auto-'));
    const dir = join(root, 'projects', 'slug');
    mkdirSync(dir, { recursive: true });
    const rec = (entrypoint: string) => JSON.stringify({ type: 'user', entrypoint, timestamp: '2026-09-01T00:00:00.000Z', message: { role: 'user', content: 'hello there' } }) + '\n';
    writeFileSync(join(dir, '11111111-0000-0000-0000-000000000001.jsonl'), rec('sdk-ts'));
    writeFileSync(join(dir, '11111111-0000-0000-0000-000000000002.jsonl'), rec('claude-vscode'));
    writeFileSync(join(dir, '11111111-0000-0000-0000-000000000003.jsonl'), rec('cli'));
    const byId = Object.fromEntries(discoverSessions(root).map((s) => [s.id.slice(-1), s.automated]));
    expect(byId).toEqual({ '1': true, '2': false, '3': false });
  });

  // The tool's own customTitle is sometimes the first prompt with its line breaks deleted outright.
  it('shows the prompt with its spaces when the tool title is only that prompt glued together', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-disc-title-'));
    const dir = join(root, 'projects', 'slug');
    mkdirSync(dir, { recursive: true });
    const prompt = 'Continue the work on search over the record. Read\n    e:\\Work\\handoff.md first, then\njournal.md and roadmap.md';
    const glued = prompt.replace(/\n\s*/g, '');
    const user = JSON.stringify({ type: 'user', timestamp: '2026-09-01T00:00:00.000Z', message: { role: 'user', content: prompt } });
    writeFileSync(join(dir, '22222222-0000-0000-0000-000000000001.jsonl'), user + '\n' + JSON.stringify({ type: 'custom-title', customTitle: glued }) + '\n');
    // a title somebody chose stays as they wrote it
    writeFileSync(join(dir, '22222222-0000-0000-0000-000000000002.jsonl'), user + '\n' + JSON.stringify({ type: 'custom-title', customTitle: 'Search work, part two' }) + '\n');
    const byId = Object.fromEntries(discoverSessions(root).map((s) => [s.id.slice(-1), s.title]));
    expect(byId['1']).toBe('Continue the work on search over the record. Read e:\\Work\\handoff.md first, then journal.md and roadmap.md');
    expect(byId['2']).toBe('Search work, part two');
  });

  // A cold listing read every file in one synchronous hold, 8.7 to 17.8 s after each restart. The
  // cache is kept on disk so a restart — here, reading another root and coming back — starts warm.
  it('survives a restart through the copy on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-disc-disk-'));
    const dir = join(root, 'projects', 'slug');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, '88888888-2222-3333-4444-555555555555.jsonl');
    const line = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t }) + '\n';
    const fixed = new Date('2026-09-01T00:00:00.000Z');
    writeFileSync(file, line('Disk AAAA'));
    utimesSync(file, fixed, fixed);
    expect(discoverSessions(root)[0].title).toBe('Disk AAAA');
    expect(existsSync(join(root, 'agenttrace', 'sessions-described.json'))).toBe(true);

    discoverSessions(mkdtempSync(join(tmpdir(), 'at-disc-other-'))); // the in-memory cache now holds another root

    // same length, same mtime: only a description read back from disk can still say AAAA
    writeFileSync(file, line('Disk BBBB'));
    utimesSync(file, fixed, fixed);
    expect(discoverSessions(root)[0].title).toBe('Disk AAAA');
  });
});
