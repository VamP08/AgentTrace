import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tailer, classify, type TailBatch } from '../src/tail.js';

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const rec = (uuid: string, text: string) => JSON.stringify({ type: 'user', uuid, timestamp: 't', message: { role: 'user', content: text } });

function waitFor<T>(check: () => T | undefined, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

let tailer: Tailer | undefined;
afterEach(async () => {
  await tailer?.stop();
  tailer = undefined;
});

describe('classify', () => {
  const root = join('C:', 'r', 'projects');
  it('main transcript', () => {
    expect(classify(root, join(root, 'slug', `${SID}.jsonl`))).toEqual({ projectSlug: 'slug', sessionId: SID });
  });
  it('subagent transcript', () => {
    expect(classify(root, join(root, 'slug', SID, 'subagents', 'agent-ab12.jsonl'))).toEqual({ projectSlug: 'slug', sessionId: SID, agentId: 'ab12' });
  });
  it('ignores meta, tool-results and files outside', () => {
    expect(classify(root, join(root, 'slug', SID, 'subagents', 'agent-ab12.meta.json'))).toBeUndefined();
    expect(classify(root, join(root, 'slug', SID, 'tool-results', 'x.txt'))).toBeUndefined();
    expect(classify(root, join('C:', 'elsewhere', 'a.jsonl'))).toBeUndefined();
  });
});

describe('Tailer', () => {
  it('streams appended lines, holds partial lines, picks up new subagent files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'at-tail-'));
    const projects = join(root, 'projects');
    const dir = join(projects, 'slug');
    mkdirSync(dir, { recursive: true });
    const main = join(dir, `${SID}.jsonl`);
    writeFileSync(main, rec('old', 'already there') + '\n');

    const batches: TailBatch[] = [];
    tailer = new Tailer(projects).start();
    tailer.on('events', (b: TailBatch) => batches.push(b));
    await new Promise((r) => setTimeout(r, 1700)); // let the watcher settle past its startup window

    // pre-existing content must not be replayed
    expect(batches).toEqual([]);

    // a whole line arrives
    appendFileSync(main, rec('n1', 'first live') + '\n');
    const b1 = await waitFor(() => batches.find((b) => b.events.some((e) => e.id === 'n1')));
    expect(b1).toMatchObject({ projectSlug: 'slug', sessionId: SID });
    expect(b1.agentId).toBeUndefined();

    // half a line, then the rest: only one event, emitted once complete
    const full = rec('n2', 'split across writes');
    appendFileSync(main, full.slice(0, 20));
    await new Promise((r) => setTimeout(r, 300));
    expect(batches.flatMap((b) => b.events).some((e) => e.id === 'n2')).toBe(false);
    appendFileSync(main, full.slice(20) + '\n');
    await waitFor(() => batches.find((b) => b.events.some((e) => e.id === 'n2')));

    // a new subagent file created after start streams from byte zero with its agent id
    const sub = join(dir, SID, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-ab12.jsonl'), rec('s1', 'agent line') + '\n');
    const b3 = await waitFor(() => batches.find((b) => b.agentId === 'ab12'));
    expect(b3.events[0]).toMatchObject({ id: 's1', sessionId: SID, agentId: 'ab12' });

    rmSync(root, { recursive: true, force: true });
  }, 15000);
});
