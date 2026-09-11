// The shared library and what "finished" means. The interesting cases are the merge — which is
// deterministic on purpose, because the app has no model to decide what two sections have in
// common — and the difference between a slot nobody wrote and one that cannot be written here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { briefEntries, completeness, completionBrief, encountersOf, readLibrary, resolveLesson, sections, slotBasis, stackCoverage } from '../src/library.js';
import type { LearningEntry, ProjectRecord } from '@agenttrace/shared';

let root: string;

const FULL = `---
title: Rate limiting
summary: A budget that refills
type: pattern
level: intermediate
objectives: [say what a token bucket is]
sources:
  - url: https://stripe.com/blog/rate-limiters
    took: the four limiter types
verified: { command: node bucket.mjs, exit: 0, version: node v24 }
questions:
  - { id: q1, kind: recall, q: How many are served?, a: Three hundred. }
  - { id: q2, kind: apply, q: Why its own bucket?, a: The unit is wrong. }
exercise: { id: e1, task: Implement a bucket, hint: Pass the time in, solution: "const b = 1;" }
---
## What it is

A budget that refills.

## Why you would reach for it

One caller should not spend the service.

## The idea in one picture

A diagram.

## How it works

Steps, then numbers.

## Cheat sheet

A table.

## Common mistakes

Limiting the wrong unit.

## Go deeper

Links that were opened.
`;

const THIN = `---
title: Byte offset tailing
type: pattern
cannot_fill:
  verified: the project's environment is gone, so the example cannot be run here
---
## What it is

A bookmark.

## Why here

Rereading is expensive.

## The idea in one picture

A state machine.

## How it works

Read past the offset.
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'atlib-'));
  mkdirSync(join(root, 'concept'), { recursive: true });
  mkdirSync(join(root, 'pkg', 'npm', 'chokidar'), { recursive: true });
  writeFileSync(join(root, 'concept', 'rate-limiting.md'), FULL);
  writeFileSync(join(root, 'concept', 'byte-offset-tailing.md'), THIN);
  writeFileSync(join(root, 'pkg', 'npm', 'chokidar', 'watching.md'), FULL.replace('Rate limiting', 'Watching a folder'));
  writeFileSync(join(root, 'concept', 'broken.md'), '---\nsummary: no title\n---\nbody\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const lesson = (over: Partial<LearningEntry>): LearningEntry => ({
  slug: 'x', title: 'x', summary: '', type: 'pattern', level: 'beginner', tags: [], files: [],
  prerequisites: [], related: [], date: '2026-01-01', updated: '2026-01-01',
  questions: [], objectives: [], sources: [], cannotFill: {}, body: '', ...over,
});

describe('sections', () => {
  it('maps both wordings of the why heading to one slot, without rewriting either', () => {
    expect(sections('## Why here\n\ntext')[0].slot).toBe('why');
    expect(sections('## Why you would reach for it\n\ntext')[0].slot).toBe('why');
    expect(sections('## Why here\n\ntext')[0].title).toBe('Why here');
  });

  it('leaves an unrecognised heading as a section with no slot', () => {
    const s = sections('## Sessions, not only turns\n\ntext');
    expect(s[0].slot).toBeUndefined();
    expect(s[0].title).toBe('Sessions, not only turns');
  });
});

describe('completeness', () => {
  it('counts a full entry as complete', () => {
    const { entries } = readLibrary(root);
    const rl = entries.find((e) => e.key === 'concept/rate-limiting')!;
    const c = completeness(rl);
    expect(c.hasFloor).toBe(true);
    expect(c.complete).toBe(true);
    expect(c.written).toBe(12);
  });

  it('never counts the computed slot as missing', () => {
    const { entries } = readLibrary(root);
    const c = completeness(entries.find((e) => e.key === 'concept/rate-limiting')!);
    expect(c.slots.find((s) => s.slot === 'where-it-shows-up')!.state).toBe('empty');
    expect(c.fillable).toBe(12); // thirteen slots, one computed
  });

  it('separates a slot nobody wrote from one that cannot be written here', () => {
    const { entries } = readLibrary(root);
    const thin = entries.find((e) => e.key === 'concept/byte-offset-tailing')!;
    const c = completeness(thin);
    const verified = c.slots.find((s) => s.slot === 'verified')!;
    const cheat = c.slots.find((s) => s.slot === 'cheat-sheet')!;
    expect(verified.state).toBe('unfillable');
    expect(verified.reason).toMatch(/environment is gone/);
    expect(cheat.state).toBe('empty');
    expect(c.fillable).toBe(11); // the unfillable one leaves the denominator
    // and the floor is still not met, because this entry has no questions
    expect(c.hasFloor).toBe(false);
    expect(c.slots.find((s) => s.slot === 'questions')!.state).toBe('empty');
  });

  it('reports a missing floor when a required slot is absent', () => {
    expect(completeness({ body: '## What it is\n\ntext' }).hasFloor).toBe(false);
  });
});

describe('readLibrary', () => {
  it('keys entries by their path below the root, with forward slashes at any depth', () => {
    const { entries } = readLibrary(root);
    expect(entries.map((e) => e.key)).toContain('concept/rate-limiting');
    expect(entries.map((e) => e.key)).toContain('pkg/npm/chokidar/watching');
  });

  it('reports a file with no title instead of returning it half-empty', () => {
    const { entries, unparsed } = readLibrary(root);
    expect(entries.find((e) => e.key === 'concept/broken')).toBeUndefined();
    expect(unparsed[0].error).toMatch(/no "title"/);
  });

  it('returns nothing for a library path that does not exist', () => {
    expect(readLibrary(join(root, 'nope')).entries).toEqual([]);
  });
});

describe('resolveLesson', () => {
  const library = () => readLibrary(root).entries;

  it('renders a lesson with no extends exactly as it is', () => {
    const r = resolveLesson(lesson({ body: '## What it is\n\nmine' }), library());
    expect(r.entry).toBeUndefined();
    expect(r.sections).toHaveLength(1);
    expect(r.origin['What it is']).toBe('project');
  });

  it('replaces a library section the project also writes, and keeps the rest', () => {
    const r = resolveLesson(
      lesson({ extends: 'concept/rate-limiting', body: '## How it works\n\nours, with our numbers' }),
      library(),
    );
    expect(r.entry!.key).toBe('concept/rate-limiting');
    expect(r.sections.find((s) => s.title === 'How it works')!.body).toBe('ours, with our numbers');
    expect(r.origin['How it works']).toBe('project');
    expect(r.origin['What it is']).toBe('library');
    expect(r.sections.map((s) => s.title)).toContain('Cheat sheet');
  });

  it('appends a section the library does not have, in the project\'s own order', () => {
    const r = resolveLesson(
      lesson({ extends: 'concept/rate-limiting', body: '## Where to look\n\nthe file in this repo' }),
      library(),
    );
    expect(r.sections[r.sections.length - 1].title).toBe('Where to look');
    expect(r.origin['Where to look']).toBe('project');
  });

  it('replaces a section that fills the same slot under a different heading', () => {
    // The library says "Why you would reach for it"; the lesson says "Why here". Same slot, and
    // the reader must get one of them, not both.
    const r = resolveLesson(
      lesson({ extends: 'concept/rate-limiting', body: '## Why here\n\nbecause this repo needed it' }),
      library(),
    );
    const whys = r.sections.filter((s) => s.slot === 'why');
    expect(whys).toHaveLength(1);
    expect(whys[0].title).toBe('Why here');
    expect(whys[0].body).toBe('because this repo needed it');
    expect(r.origin['Why here']).toBe('project');
    expect(r.origin['Why you would reach for it']).toBeUndefined();
  });

  it('still keys unslotted sections by their heading text', () => {
    const r = resolveLesson(
      lesson({ extends: 'concept/rate-limiting', body: '## Where to look\n\nours' }),
      library(),
    );
    expect(r.sections.filter((s) => s.title === 'Where to look')).toHaveLength(1);
  });

  it('matches the extends key by slug as well as by full path', () => {
    expect(resolveLesson(lesson({ extends: 'rate-limiting' }), library()).entry!.key).toBe('concept/rate-limiting');
  });

  it('says which entry is missing rather than silently rendering a bare overlay', () => {
    const r = resolveLesson(lesson({ extends: 'concept/nothing-here', body: '## What it is\n\nmine' }), library());
    expect(r.missingExtends).toBe('concept/nothing-here');
    expect(r.entry).toBeUndefined();
    expect(r.sections).toHaveLength(1);
  });

  it('counts a slot the project supplies that the library lacks', () => {
    const thin = lesson({ extends: 'concept/byte-offset-tailing', body: '## Cheat sheet\n\nour table' });
    const r = resolveLesson(thin, library());
    expect(r.completeness.slots.find((s) => s.slot === 'cheat-sheet')!.state).toBe('written');
  });

  it('carries the library\'s unfillable reason through the merge', () => {
    const r = resolveLesson(lesson({ extends: 'concept/byte-offset-tailing' }), library());
    expect(r.completeness.slots.find((s) => s.slot === 'verified')!.state).toBe('unfillable');
  });
});

describe('completionBrief', () => {
  it('leaves out entries that need nothing', () => {
    const { entries } = readLibrary(root);
    const b = completionBrief(entries);
    expect(b.entries.find((e) => e.key === 'concept/rate-limiting')).toBeUndefined();
    expect(b.entries.find((e) => e.key === 'concept/byte-offset-tailing')).toBeDefined();
  });

  it('never asks for a slot the entry says cannot be filled here', () => {
    const { entries } = readLibrary(root);
    const thin = completionBrief(entries).entries.find((e) => e.key === 'concept/byte-offset-tailing')!;
    expect(thin.missing).not.toContain('verified');
    expect(thin.unfillable).toContain('verified');
  });

  it('never asks for the computed slot', () => {
    const { entries } = readLibrary(root);
    for (const e of completionBrief(entries).entries) expect(e.missing).not.toContain('where-it-shows-up');
  });

  it('measures the basis from entries that have the slot, and says so', () => {
    const { entries } = readLibrary(root);
    const basis = slotBasis(entries);
    const cheat = basis.find((b) => b.slot === 'cheat-sheet')!;
    expect(cheat.from).toBe('measured');
    expect(cheat.samples).toBeGreaterThan(0);
  });

  it('falls back to a single observation for a slot nothing has yet, and labels it', () => {
    const basis = slotBasis([{ body: '## What it is\n\nonly this' }]);
    expect(basis.find((b) => b.slot === 'cheat-sheet')!.from).toBe('single observation');
    expect(basis.find((b) => b.slot === 'what-it-is')!.from).toBe('measured');
  });

  it('carries the arithmetic so the screen can show it', () => {
    const b = completionBrief(readLibrary(root).entries);
    expect(b.method.join(' ')).toMatch(/median/);
    expect(b.method.join(' ')).toMatch(/floor rather than a forecast/);
  });

  it('costs more when a missing slot needs sources fetched', () => {
    const withSources = completionBrief([{ key: 'a', title: 'a', body: '## What it is\n\nx' }]).entries[0];
    const noSources = completionBrief([
      { key: 'b', title: 'b', body: '## What it is\n\nx', cannotFill: { sources: 'offline', 'go-deeper': 'offline' } },
    ]).entries[0];
    expect(withSources.tokens).toBeGreaterThan(noSources.tokens);
  });
});

describe('briefEntries', () => {
  const record = (learning: LearningEntry[]): ProjectRecord => ({
    project: 'P', root: '', repoDir: '', learning, decisions: [], journal: [],
    library: readLibrary(root).entries, unparsed: [],
  });

  it('measures an overlay after the merge, not on its own', () => {
    // The overlay carries one section. Measured alone it looks empty; measured resolved it
    // inherits everything the library entry already has.
    const overlay = lesson({ slug: 'rl', extends: 'concept/rate-limiting', body: '## Why here\n\nours' });
    const alone = completionBrief([{ key: 'x', title: 'x', body: overlay.body }]).entries[0];
    expect(alone.missing.length).toBeGreaterThan(8);

    const resolved = completionBrief(briefEntries(record([overlay]))).entries;
    expect(resolved.find((e) => e.key === 'learning/rl')).toBeUndefined();
  });

  it('measures a lesson with no extends exactly as it is', () => {
    const plain = lesson({ slug: 'plain', body: '## What it is\n\nonly this' });
    const e = completionBrief(briefEntries(record([plain]))).entries.find((x) => x.key === 'learning/plain')!;
    expect(e.missing).toContain('cheat-sheet');
    expect(e.missing).toContain('questions');
  });

  it('measures an overlay whose library entry is missing on its own, rather than crashing', () => {
    const orphan = lesson({ slug: 'orphan', extends: 'concept/not-here', body: '## Why here\n\nours' });
    const e = completionBrief(briefEntries(record([orphan]))).entries.find((x) => x.key === 'learning/orphan')!;
    expect(e).toBeDefined();
    expect(e.missing).toContain('what-it-is');
  });
});

describe('stackCoverage', () => {
  const REQUIRED = ['what-it-is', 'why', 'picture', 'how-it-works', 'questions'];

  const withStack = (rows: any[], learning: LearningEntry[] = []): ProjectRecord => ({
    project: 'P', root: '', repoDir: '', learning, decisions: [], journal: [],
    library: readLibrary(root).entries, unparsed: [],
    stack: { data: { stack: rows }, body: '' } as any,
  });

  it('counts a technology whose stack row names a lesson that exists', () => {
    const c = stackCoverage(withStack([{ name: 'Redis', learning: 'redis-caching' }], [lesson({ slug: 'redis-caching' })]), slotBasis([]))!;
    expect(c.covered).toBe(1);
    expect(c.uncovered).toHaveLength(0);
  });

  it('does not count a stack row whose named lesson does not exist', () => {
    const c = stackCoverage(withStack([{ name: 'Redis', learning: 'never-written' }]), slotBasis([]))!;
    expect(c.covered).toBe(0);
    expect(c.uncovered[0].name).toBe('Redis');
  });

  it('counts a technology matched by name against a library entry', () => {
    const c = stackCoverage(withStack([{ name: 'Rate Limiting' }]), slotBasis([]))!;
    expect(c.covered).toBe(1);
  });

  it('lists a technology with nothing at all, and costs it at what first writes here actually contain', () => {
    const basis = slotBasis(readLibrary(root).entries);
    const c = stackCoverage(withStack([{ name: 'Apache POI', category: 'other', why: 'writes the workbook' }]), basis)!;
    const poi = c.uncovered[0];
    // Measured, not assumed: this fixture's entries are mostly complete, so a first write here
    // is costed above the floor. Costing it at the floor is what came in 2.12x under on real data.
    expect(poi.slots.length).toBeGreaterThan(REQUIRED.length);
    expect(poi.slots).toEqual(expect.arrayContaining(REQUIRED));
    expect(c.firstWriteBasis).toMatch(/more than half of the 3 entries/);
    expect(poi.why).toBe('writes the workbook');
    expect(poi.suggestedKey).toBe('concept/apache-poi');
  });

  it('falls back to the floor when nothing has been written to measure', () => {
    const bare: ProjectRecord = {
      project: 'P', root: '', repoDir: '', learning: [], decisions: [], journal: [], library: [], unparsed: [],
      stack: { data: { stack: [{ name: 'Redis' }] }, body: '' } as any,
    };
    const c = stackCoverage(bare, slotBasis([]))!;
    expect(c.firstWriteSlots).toEqual(REQUIRED);
    expect(c.firstWriteBasis).toMatch(/no entries written yet/);
  });

  it('separates covered from anchored: an entry nobody here extends is unanchored', () => {
    const basis = slotBasis(readLibrary(root).entries);
    const noOverlay = stackCoverage(withStack([{ name: 'Rate Limiting' }]), basis)!;
    expect(noOverlay.covered).toBe(1);
    expect(noOverlay.uncovered).toHaveLength(0);
    expect(noOverlay.unanchored.map((u) => u.key)).toEqual(['concept/rate-limiting']);

    const withOverlay = stackCoverage(
      withStack([{ name: 'Rate Limiting' }], [lesson({ slug: 'rl', extends: 'concept/rate-limiting' })]),
      basis,
    )!;
    expect(withOverlay.unanchored).toHaveLength(0);
  });

  it('suggests the package namespace when the row carries a purl', () => {
    const c = stackCoverage(withStack([{ name: 'chokidar', purl: 'pkg:npm/chokidar' }]), slotBasis([]))!;
    expect(c.uncovered[0].suggestedKey).toBe('pkg/npm/chokidar/chokidar');
  });

  it('returns nothing for a project with no stack.md, rather than a coverage of zero', () => {
    const bare: ProjectRecord = { project: 'P', root: '', repoDir: '', learning: [], decisions: [], journal: [], library: [], unparsed: [] };
    expect(stackCoverage(bare, slotBasis([]))).toBeUndefined();
  });

  it('folds the cost of what is missing into the brief total', () => {
    const basis = slotBasis(readLibrary(root).entries);
    const rec = withStack([{ name: 'Apache POI' }, { name: 'Redis' }]);
    const withoutCoverage = completionBrief(briefEntries(rec), basis);
    const withCoverage = completionBrief(briefEntries(rec), basis, stackCoverage(rec, basis));
    expect(withCoverage.totalTokens).toBeGreaterThan(withoutCoverage.totalTokens);
    expect(withCoverage.coverage!.uncovered).toHaveLength(2);
  });
});

describe('encountersOf', () => {
  it('finds every project lesson that overlays an entry', () => {
    const rec = (project: string, ext?: string): ProjectRecord => ({
      project, root: '', repoDir: '', learning: ext ? [lesson({ slug: 'rl', title: 'Rate limiting here', extends: ext, files: ['src/a.ts'] })] : [],
      decisions: [], journal: [], library: [], unparsed: [],
    });
    const found = encountersOf('concept/rate-limiting', [rec('HRMS', 'concept/rate-limiting'), rec('Other', 'rate-limiting'), rec('None')]);
    expect(found.map((e) => e.project)).toEqual(['HRMS', 'Other']);
    expect(found[0].files).toEqual(['src/a.ts']);
  });
});
