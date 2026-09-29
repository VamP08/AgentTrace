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
  // A plain YAML scalar starting with a backtick: js-yaml rejects it, so this file has no usable frontmatter.
  writeFileSync(join(record, 'learning', 'backtick.md'), '---\ntitle: Ids\nsummary: s\ndate: 2026-09-03T14:00:00+05:30\nexercise:\n  task: Give each row a stable id.\n  hint: `crypto.randomUUID()` gives a new one per call.\n---\nbody\n');
  writeFileSync(join(record, 'learning', 'no-title.md'), '---\nsummary: parses fine, says nothing\ntype: term\ndate: 2026-09-03T15:00:00+05:30\n---\nbody\n');
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
    // a date-only value stays a date; it used to print as 2026-09-03T00:00:00.000Z on every entry
    expect(r.journal[0].date).toBe('2026-09-03');
    // a real timestamp keeps its time
    expect(r.journal[0].started).toBe('2026-09-03T04:43:00.000Z');
    expect(r.unparsed.map((u) => u.file)).toEqual(['learning/backtick.md', 'learning/broken.md', 'learning/no-title.md']);
    expect(r.design).toBeUndefined();
  });

  it('reports a lesson whose frontmatter will not parse, on every read, instead of returning it half-empty', () => {
    const repo = fakeProject();
    // Twice: gray-matter caches by raw text, and a failed parse used to be served from that cache as empty data.
    for (const pass of [1, 2]) {
      const r = readRecord(repo)!;
      expect(r.learning.map((l) => l.slug), `pass ${pass}`).toEqual(['jsonl', 'later']);
      const entry = r.unparsed.find((u) => u.file === 'learning/backtick.md');
      expect(entry, `pass ${pass}`).toBeDefined();
      expect(entry!.error).toContain('learning/backtick.md');
      expect(entry!.error).toContain('did not parse');
    }
  });

  it('reports a lesson that parses but has no title', () => {
    const r = readRecord(fakeProject())!;
    expect(r.learning.some((l) => l.slug === 'no-title')).toBe(false);
    const entry = r.unparsed.find((u) => u.file === 'learning/no-title.md');
    expect(entry?.error).toBe('learning/no-title.md: frontmatter did not parse or has no "title"');
  });
});
