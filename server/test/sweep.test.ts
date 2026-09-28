// The archive sweep and the shared index pass. Both exist because the work they do used to run
// inline on every project-index request, where a warm poll over 1,949 sessions took 17 seconds and
// overlapping polls each started their own pass. What has to hold: the sweep still copies what
// changed and nothing else, the count it hands back is right, and two passes asked for at once are
// one pass.
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepArchive } from '../src/archive.js';
import { discoverSessions } from '../src/discover.js';
import { buildFacts } from '../src/projects.js';

const ids = ['11111111-2222-3333-4444-555555555555', '66666666-7777-8888-9999-000000000000'];
const line = (i: number) => JSON.stringify({ type: 'user', cwd: 'e:\\Work\\demo', timestamp: `2026-09-03T01:00:0${i}.000Z`, message: { role: 'user', content: `turn ${i}` } }) + '\n';

function fakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'at-sweep-'));
  const live = join(root, 'projects', 'e--Work-demo');
  mkdirSync(live, { recursive: true });
  for (const id of ids) writeFileSync(join(live, `${id}.jsonl`), line(1));
  return root;
}

describe('sweepArchive', () => {
  it('copies every session once, then only the one that grew, and counts what it holds', async () => {
    const root = fakeRoot();
    const first = await sweepArchive(root, discoverSessions(root));
    expect(first.copied).toBe(2);
    expect(first.stats.sessions).toBe(2);
    for (const id of ids) expect(existsSync(join(root, 'agenttrace', 'archive', 'projects', 'e--Work-demo', `${id}.jsonl`))).toBe(true);

    expect((await sweepArchive(root, discoverSessions(root))).copied).toBe(0);

    appendFileSync(join(root, 'projects', 'e--Work-demo', `${ids[1]}.jsonl`), line(2));
    const third = await sweepArchive(root, discoverSessions(root));
    expect(third.copied).toBe(1);
    expect(third.stats.bytes).toBeGreaterThan(first.stats.bytes);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('buildFacts', () => {
  it('hands concurrent callers the same pass instead of starting one each', async () => {
    const root = fakeRoot();
    const a = buildFacts(root);
    const b = buildFacts(root);
    expect(b).toBe(a);
    const done = await a;
    expect(done.sessions.size).toBe(2);
    // once it has finished, the next caller gets a fresh pass rather than a stale result forever
    expect(buildFacts(root)).not.toBe(a);
    await buildFacts(root);
    rmSync(root, { recursive: true, force: true });
  });

  it('no longer copies anything into the archive; that is the sweep’s job', async () => {
    const root = fakeRoot();
    await buildFacts(root);
    expect(existsSync(join(root, 'agenttrace', 'archive', 'projects'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
