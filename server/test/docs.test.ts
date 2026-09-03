import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findManifest, findManifestFor, readRecord } from '../src/docs.js';

function fakeProject() {
  const repo = mkdtempSync(join(tmpdir(), 'at-repo-'));
  const record = join(repo, 'record');
  mkdirSync(join(record, 'learning'), { recursive: true });
  mkdirSync(join(record, 'decisions'), { recursive: true });
  mkdirSync(join(record, 'journal'), { recursive: true });
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  writeFileSync(join(repo, 'agenttrace.json'), JSON.stringify({ contract: 1, project: 'Demo', record: 'record' }));
  writeFileSync(join(record, 'roadmap.md'), '---\nproject: Demo\nupdated: 2026-09-03T10:00:00+05:30\nmilestones:\n  - id: M0\n    title: Start\n    status: done\n    gate: exists\n---\n**Positioning.** A demo.\n');
  writeFileSync(join(record, 'learning', 'jsonl.md'), '---\ntitle: JSONL\nsummary: one object per line\ntype: term\nlevel: beginner\ntags: [format]\nfiles: [a.ts]\ndate: 2026-09-03T12:00:00+05:30\n---\n**What it is.** Lines.\n');
  writeFileSync(join(record, 'learning', 'later.md'), '---\ntitle: Later\nsummary: s\ntype: pattern\nlevel: advanced\ndate: 2026-09-03T13:00:00+05:30\n---\nbody\n');
  writeFileSync(join(record, 'learning', 'broken.md'), '---\ntitle: [unclosed\n---\nbody\n');
  writeFileSync(join(record, 'decisions', 'no-db.md'), '---\ntitle: No database\nstatus: accepted\ndate: 2026-09-03T09:00:00+05:30\ntags: [storage]\n---\n**Context.** x\n');
  writeFileSync(join(record, 'journal', '2026-09-03-1013.md'), '---\ndate: 2026-09-03\nstarted: 2026-09-03T10:13:00+05:30\nmilestone: M0\nsummary: did things\nlearning: [jsonl]\ncommits: [abc]\nnext: [more]\n---\n**Done.** stuff\n');
  return repo;
}

describe('findManifest', () => {
  it('walks up from a nested cwd and resolves a relative record path', () => {
    const repo = fakeProject();
    const found = findManifest(join(repo, 'src', 'deep'));
    expect(found?.manifest.project).toBe('Demo');
    expect(found?.root).toBe(join(repo, 'record'));
  });
  it('returns nothing where no manifest exists', () => {
    expect(findManifest(tmpdir())).toBeUndefined();
  });
  it('falls back to the folders of files the session touched', () => {
    const repo = fakeProject();
    const parent = join(repo, '..');
    expect(findManifest(parent)).toBeUndefined();
    expect(findManifestFor(parent, [join(repo, 'src', 'a.ts'), join(repo, 'src', 'b.ts')])?.manifest.project).toBe('Demo');
  });
});

describe('readRecord', () => {
  it('parses every document type, orders entries, and lists broken files instead of hiding them', () => {
    const r = readRecord(fakeProject())!;
    expect(r.project).toBe('Demo');
    expect(r.roadmap?.data.milestones[0]).toMatchObject({ id: 'M0', status: 'done' });
    expect(r.learning.map((l) => l.slug)).toEqual(['jsonl', 'later']);
    expect(r.learning[0]).toMatchObject({ title: 'JSONL', type: 'term', tags: ['format'], files: ['a.ts'] });
    expect(r.learning[0].body).toContain('What it is');
    expect(r.decisions[0]).toMatchObject({ slug: 'no-db', status: 'accepted' });
    expect(r.journal[0]).toMatchObject({ milestone: 'M0', learning: ['jsonl'], commits: ['abc'] });
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0].file).toBe('learning/broken.md');
    expect(r.design).toBeUndefined();
  });
});
