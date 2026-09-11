// The record is the one thing AgentTrace reads that a person edits and tidies, and a tidy-up is
// how forty-one files were once lost. These pin the second copy: it refreshes when the record
// changes, costs nothing when it has not, and — the case that matters — never lets an empty or
// vanished record overwrite a good copy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveRecord, recordArchivePath } from '../src/archive.js';

let claudeRoot: string;
let recordRoot: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'atrec-'));
  claudeRoot = join(base, 'claude');
  recordRoot = join(base, 'record');
  mkdirSync(join(recordRoot, 'learning'), { recursive: true });
  writeFileSync(join(recordRoot, 'roadmap.md'), '---\nproject: P\n---\nbody\n');
  writeFileSync(join(recordRoot, 'learning', 'a.md'), '---\ntitle: A\n---\nbody\n');
});
afterEach(() => rmSync(join(claudeRoot, '..'), { recursive: true, force: true }));

const dest = () => recordArchivePath(claudeRoot, 'P');

describe('archiveRecord', () => {
  it('copies the record on the first pass', () => {
    expect(archiveRecord(claudeRoot, 'P', recordRoot)).toBe(true);
    expect(existsSync(join(dest(), 'roadmap.md'))).toBe(true);
    expect(existsSync(join(dest(), 'learning', 'a.md'))).toBe(true);
  });

  it('does nothing on a second pass when the record has not changed', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    expect(archiveRecord(claudeRoot, 'P', recordRoot)).toBe(false);
  });

  it('copies again when a file is added', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    writeFileSync(join(recordRoot, 'learning', 'b.md'), '---\ntitle: B\n---\nbody\n');
    expect(archiveRecord(claudeRoot, 'P', recordRoot)).toBe(true);
    expect(existsSync(join(dest(), 'learning', 'b.md'))).toBe(true);
  });

  it('drops a file from the copy once it is gone from the record', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    rmSync(join(recordRoot, 'learning', 'a.md'));
    writeFileSync(join(recordRoot, 'learning', 'c.md'), '---\ntitle: C\n---\nbody\n');
    archiveRecord(claudeRoot, 'P', recordRoot);
    expect(existsSync(join(dest(), 'learning', 'a.md'))).toBe(false);
    expect(existsSync(join(dest(), 'learning', 'c.md'))).toBe(true);
  });

  it('keeps the copy when the record folder is deleted, which is the whole point', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    rmSync(recordRoot, { recursive: true, force: true });
    expect(archiveRecord(claudeRoot, 'P', recordRoot)).toBe(false);
    expect(existsSync(join(dest(), 'roadmap.md'))).toBe(true);
    expect(readFileSync(join(dest(), 'learning', 'a.md'), 'utf8')).toContain('title: A');
  });

  it('keeps the copy when the record folder is emptied rather than removed', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    rmSync(join(recordRoot, 'roadmap.md'));
    rmSync(join(recordRoot, 'learning'), { recursive: true, force: true });
    expect(archiveRecord(claudeRoot, 'P', recordRoot)).toBe(false);
    expect(existsSync(join(dest(), 'roadmap.md'))).toBe(true);
  });

  it('keeps one folder per project and does not mix them', () => {
    archiveRecord(claudeRoot, 'P', recordRoot);
    archiveRecord(claudeRoot, 'Other/Name', recordRoot);
    const roots = readdirSync(join(claudeRoot, 'agenttrace', 'archive', 'records'));
    expect(roots).toHaveLength(2);
    expect(roots).toContain('P');
  });
});
