import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDetail, Session } from '@agenttrace/shared';
import { buildDossier } from '../src/dossier.js';

describe('buildDossier, commit join and documents beside the record', () => {
  it('gives a commit to the session whose transcript made it, else to the nearest line within thirty minutes, and reads the notes folder', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'at-dossier2-'));
    const at = (iso: string) => ({ ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
    const g = (env: NodeJS.ProcessEnv, ...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true, env }).trim();
    const first = at('2026-09-03T05:05:00Z');
    g(first, 'init', '-q');
    g(first, 'config', 'user.email', 'a@b.c');
    g(first, 'config', 'user.name', 'a');
    writeFileSync(join(repo, 'pom.xml'), '<project><artifactId>spring-boot-starter-web</artifactId></project>\n');
    g(first, 'add', '.');
    g(first, 'commit', '-q', '-m', 'first light');
    const sha = g(first, 'rev-parse', '--short', 'HEAD');
    const later = at('2026-09-03T09:00:00Z');
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    g(later, 'add', '.');
    g(later, 'commit', '-q', '-m', 'an idle-hour commit');

    const root = mkdtempSync(join(tmpdir(), 'at-dossier2-root-'));
    const mk = (id: string, lines: object[]) => {
      const dir = join(root, 'projects', 'slug', id);
      mkdirSync(dir, { recursive: true });
      const file = join(root, 'projects', 'slug', `${id}.jsonl`);
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      return { file, dir };
    };
    // near: a line four minutes before the first commit, but its transcript shows no commit
    const near = 'aaaaaaaa-0000-0000-0000-000000000001';
    const n = mk(near, [{ type: 'user', uuid: 'u1', timestamp: '2026-09-03T05:01:00Z', cwd: repo, sessionId: near, message: { role: 'user', content: 'near' } }]);
    // maker: weeks earlier by the clock, but its shell output shows the commit being made
    const maker = 'aaaaaaaa-0000-0000-0000-000000000002';
    const m = mk(maker, [
      { type: 'user', uuid: 'u2', timestamp: '2026-08-01T05:00:00Z', cwd: repo, sessionId: maker, message: { role: 'user', content: 'commit it' } },
      { type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: '2026-08-01T05:01:00Z', cwd: repo, sessionId: maker, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git commit -m "first light"' } }] } },
      { type: 'user', uuid: 'r2', parentUuid: 'a2', timestamp: '2026-08-01T05:01:05Z', cwd: repo, sessionId: maker, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: `[main ${sha}] first light\n 1 file changed` }] } },
    ]);
    const S = (id: string, title: string, f: { file: string; dir: string }, startedAt: string, updatedAt: string): Session => ({ id, projectSlug: 'slug', cwd: repo, title, startedAt, updatedAt, bytes: 1, live: false, archived: false, file: f.file, dir: f.dir, fileHistory: join(root, 'fh', id) });
    const sessions = new Map<string, Session>([
      [near, S(near, 'near', n, '2026-09-03T05:01:00Z', '2026-09-03T05:01:00Z')],
      [maker, S(maker, 'maker', m, '2026-08-01T05:00:00Z', '2026-08-01T05:01:05Z')],
    ]);
    const row = (id: string, title: string, startedAt: string, updatedAt: string) => ({ id, title, edits: 1, primary: true, byCwdOnly: false, calls: 1, failed: 0, startedAt, updatedAt, live: false });
    const notes = mkdtempSync(join(tmpdir(), 'at-dossier2-notes-'));
    writeFileSync(join(notes, 'ROADMAP.md'), '# theirs\n');
    writeFileSync(join(notes, 'PROGRESS.md'), '# log\n');
    mkdirSync(join(notes, 'adr'));
    const rec = join(notes, 'agenttrace');
    mkdirSync(rec);
    const p: ProjectDetail = {
      id: 'commit:x', kind: 'local', name: 'demo', root: repo, sessions: [], edits: 2, calls: 2, failed: 0, firstTs: '', lastTs: '', live: false, gone: false,
      recordRoot: rec, recordMissing: false, neighbours: [],
      sessionList: [row(near, 'near', '2026-09-03T05:01:00Z', '2026-09-03T05:01:00Z'), row(maker, 'maker', '2026-08-01T05:00:00Z', '2026-08-01T05:01:05Z')],
    };
    const md = await buildDossier(p, sessions);
    expect(md).toMatch(/\| first light \| maker \|/);
    expect(md).toMatch(/\| an idle-hour commit \| no session active \|/);
    expect(md).toMatch(/### 2026-08-01 · maker[^#]*- Commits: `[0-9a-f]+` first light/);
    expect(md).not.toMatch(/### 2026-09-03 · near[^#]*- Commits:/);
    // documents beside the record, one level up from an `agenttrace` subfolder, with the record's own names left out
    expect(md).toMatch(/Documents already kept for the project: .*ROADMAP\.md/);
    expect(md).toMatch(/Decision records found: .*\/adr/);
    expect(md).toMatch(/Dated status log found: .*PROGRESS\.md/);
    // the working copy shows what no session wrote
    expect(md).toContain('## Stack in the working copy, not seen in any session');
    expect(md).toMatch(/\| spring-boot \| framework \| pom\.xml \(spring-boot-starter-web\) \|/);
    expect(md).toMatch(/\| maven \| build \| pom\.xml \|/);
  });
});
