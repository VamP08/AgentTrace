// Finding a folder's repository by walking up to `.git` instead of starting git. On this machine's
// 64 real session folders it agreed with git on every one; none of them was a worktree, so the
// layout that needs the `commondir` hop is proven here instead.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRootByWalk } from '../src/projects.js';

// .native also expands Windows short names (RUNNER~1), which git writes out in full
const key = (p: string | null | undefined) => (p ? realpathSync.native(p).toLowerCase() : p);

describe('repoRootByWalk', () => {
  it('finds the working copy from a nested folder, and maps a worktree to its main repository', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'at-walk-')));
    const main = join(base, 'main');
    mkdirSync(join(main, 'src', 'deep'), { recursive: true });
    const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    g(main, 'init', '-q');
    g(main, 'config', 'user.email', 'a@b.c');
    g(main, 'config', 'user.name', 'a');
    writeFileSync(join(main, 'a.txt'), 'one\n');
    g(main, 'add', 'a.txt');
    g(main, 'commit', '-q', '-m', 'first');

    expect(key(repoRootByWalk(join(main, 'src', 'deep')))).toBe(key(main));

    // a worktree's .git is a file; the answer is still the main working copy, as git's
    // --git-common-dir gives, so a worktree never becomes a project of its own
    const wt = join(base, 'wt');
    g(main, 'worktree', 'add', '-q', wt);
    mkdirSync(join(wt, 'inner'));
    expect(key(repoRootByWalk(join(wt, 'inner')))).toBe(key(main));

    // a .git file naming nothing recognisable is left to git rather than guessed
    const odd = join(base, 'odd');
    mkdirSync(odd);
    writeFileSync(join(odd, '.git'), 'not a gitdir line\n');
    expect(repoRootByWalk(odd)).toBeUndefined();

    rmSync(base, { recursive: true, force: true });
  });
});
