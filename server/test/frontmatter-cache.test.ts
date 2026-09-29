import { describe, expect, it } from 'vitest';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFrontmatter } from '../src/library.js';

describe('readFrontmatter', () => {
  it('parses again when the file changes, and keeps a broken file broken', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'at-fm-')), 'lesson.md');
    writeFileSync(file, '---\ntitle: First\n---\nbody one\n');
    expect(readFrontmatter(file).data.title).toBe('First');

    // same size and a new mtime: the stamp moves, so the new text is read
    writeFileSync(file, '---\ntitle: Other\n---\nbody one\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(readFrontmatter(file).data.title).toBe('Other');

    writeFileSync(file, '---\ntitle: "unclosed\n---\nbody\n');
    utimesSync(file, new Date(), new Date(Date.now() + 10000));
    expect(() => readFrontmatter(file)).toThrow();
    // a second read of the unchanged broken file still reports it
    expect(() => readFrontmatter(file)).toThrow();
  });
});
