import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDetail } from '@agenttrace/shared';
import { archiveLog, archivedCommits } from '../src/archive.js';
import { buildDossier } from '../src/dossier.js';
import { commitsBetween } from '../src/git.js';

describe('archived git log', () => {
  it('copies the default-branch log once per head, and answers commits after the folder is deleted', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'at-gitlog-'));
    const at = (iso: string) => ({ ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
    const g = (env: NodeJS.ProcessEnv, ...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true, env }).trim();
    const t1 = at('2026-09-03T05:05:00Z');
    g(t1, 'init', '-q');
    g(t1, 'config', 'user.email', 'a@b.c');
    g(t1, 'config', 'user.name', 'a');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    g(t1, 'add', '.');
    g(t1, 'commit', '-q', '-m', 'first light');
    const root = mkdtempSync(join(tmpdir(), 'at-gitlog-root-'));

    expect(archiveLog(root, repo)).toBe(true);
    expect(archiveLog(root, repo)).toBe(false); // head unchanged: nothing copied

    const t2 = at('2026-09-03T06:00:00Z');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    g(t2, 'add', '.');
    g(t2, 'commit', '-q', '-m', 'second', '-m', 'because the first was thin');
    expect(archiveLog(root, repo)).toBe(true); // head moved: copied again

    const log = archivedCommits(root, repo)!;
    expect(log.commits.map((c) => c.subject)).toEqual(['second', 'first light']);
    expect(log.commits[0].body).toBe('because the first was thin');
    expect(log.commits[0].files).toEqual([{ path: 'a.txt', added: 1, removed: 0 }]);
    expect(log.commits[0].sha).toHaveLength(40);

    // the working copy is deleted: commits and the dossier still answer from the copy
    rmSync(repo, { recursive: true, force: true });
    expect(archiveLog(root, repo)).toBe(false);
    const between = commitsBetween(repo, '2026-09-03T05:00:00Z', '2026-09-03T05:30:00Z', root);
    expect(between.map((c) => c.subject)).toEqual(['first light']);
    expect(between[0].sha).toHaveLength(7);
    expect(commitsBetween(repo, '2026-09-03T05:00:00Z', '2026-09-03T05:30:00Z')).toEqual([]); // no archive root given

    const p: ProjectDetail = { id: 'commit:x', kind: 'local', name: 'gone', root: repo, sessions: [], edits: 0, calls: 0, failed: 0, firstTs: '', lastTs: '', live: false, gone: true, sessionList: [], neighbours: [] };
    const md = await buildDossier(p, new Map(), undefined, root);
    expect(md).toContain('Working copy not on disk. Commits on');
    expect(md).toMatch(/from the archived log: 2, from 2026-09-03 to 2026-09-03/);
    expect(md).toMatch(/\| second \| no session active \|/);
    expect(md).toContain('states a reason: 1');
    expect(md).toContain('because the first was thin');
  });
});
