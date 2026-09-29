import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import type { Event, Session } from '@agenttrace/shared';
import { loadRegistry, lookup, saveRegistry, upsert } from '../src/repos.js';
import { foldProjects, repoOf, sessionFacts, useRegistry } from '../src/projects.js';

// absolute on every platform and outside any repository, so nothing is attributed by accident
const E = (...p: string[]) => join(parse(process.cwd()).root, 'at-fixture', ...p);

describe('registry', () => {
  it('finds the deepest registered root containing a path, ignoring case, and round-trips through disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-repos-'));
    const reg = loadRegistry(root);
    upsert(reg, { root: E('work', 'hrms'), remote: 'https://github.com/a/hrms.git', seen: 't' });
    upsert(reg, { root: E('work', 'hrms', 'packages', 'api'), seen: 't' });
    upsert(reg, { root: E('work', 'hrms'), record: E('notes', 'HRMS'), seen: 't2' }); // merge keeps the remote
    saveRegistry(root, reg);
    const back = loadRegistry(root);
    expect(lookup(back, E('WORK', 'hrms', 'src'))).toMatchObject({ remote: 'https://github.com/a/hrms.git', record: E('notes', 'HRMS'), seen: 't2' });
    expect(lookup(back, E('work', 'hrms', 'packages', 'api', 'x'))?.root).toBe(E('work', 'hrms', 'packages', 'api'));
    expect(lookup(back, E('work', 'hrms2'))).toBeUndefined();
  });

  it('keeps a deleted repository on its GitHub project, with its record path, through the registry', () => {
    const gone = E(`gone-${Date.now()}`, 'repo');
    const reg = loadRegistry(join(tmpdir(), 'at-no-such-registry'));
    upsert(reg, { root: gone, remote: 'git@github.com:Owner/Repo.git', rootCommit: 'abc', record: E('notes', 'Repo'), project: 'Repo', seen: 't' });
    useRegistry(reg);
    try {
      expect(repoOf(join(gone, 'src'))).toBe(resolve(gone));
      const s: Session = { id: 's1', projectSlug: 'slug', cwd: E('elsewhere'), title: 's1', startedAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T12:00:00Z', bytes: 1, live: false, archived: true, file: 'x', dir: 'y', fileHistory: 'z' };
      const write: Event = { kind: 'tool_call', id: 'w1', ts: '2026-09-03T10:01:00Z', sessionId: 's1', toolUseId: 'w1', name: 'Write', input: { file_path: join(gone, 'src', 'a.ts'), content: 'x' } };
      const f = sessionFacts([write], s, []);
      const idx = foldProjects(new Map([[s.id, f]]), new Map([[s.id, s]]));
      expect(idx.projects).toHaveLength(1);
      expect(idx.projects[0]).toMatchObject({ id: 'github.com/owner/repo', kind: 'github', name: 'owner/repo', gone: true, recordRoot: E('notes', 'Repo'), recordMissing: true });
    } finally {
      useRegistry({ version: 1, repos: {} });
    }
  });
});
