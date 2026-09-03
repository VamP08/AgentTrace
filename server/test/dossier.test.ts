import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDetail, Session } from '@agenttrace/shared';
import { buildDossier } from '../src/dossier.js';

describe('buildDossier', () => {
  it('names the remote, each commit with its session, the helpers and the stack, and the record status', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'at-dossier-'));
    const env = { ...process.env, GIT_AUTHOR_DATE: '2026-09-03T05:05:00Z', GIT_COMMITTER_DATE: '2026-09-03T05:05:00Z' };
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true, env });
    g('init', '-q');
    g('config', 'user.email', 'a@b.c');
    g('config', 'user.name', 'a');
    writeFileSync(join(repo, 'README.md'), '# demo\n');
    g('add', '.');
    g('commit', '-q', '-m', 'first light');
    g('remote', 'add', 'origin', 'https://github.com/owner/demo.git');

    const root = mkdtempSync(join(tmpdir(), 'at-dossier-root-'));
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const dir = join(root, 'projects', 'slug', id);
    mkdirSync(join(dir, 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'subagents', 'agent-abc.jsonl'), '{}\n');
    writeFileSync(join(dir, 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    const pkg = join(repo, 'package.json');
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-09-03T05:00:00Z', cwd: repo, sessionId: id, message: { role: 'user', content: 'add express' } },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-03T05:01:00Z', cwd: repo, sessionId: id, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: pkg, content: JSON.stringify({ dependencies: { express: '^4' } }) } }] } },
    ];
    const file = join(root, 'projects', 'slug', `${id}.jsonl`);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const s: Session = { id, projectSlug: 'slug', cwd: repo, title: 'add express', startedAt: '2026-09-03T05:00:00Z', updatedAt: '2026-09-03T05:10:00Z', bytes: 1, live: false, archived: false, file, dir, fileHistory: join(root, 'file-history', id) };
    const row = { id, title: 'add express', edits: 1, primary: true, byCwdOnly: false, calls: 1, failed: 0, startedAt: s.startedAt, updatedAt: s.updatedAt, live: false };
    const p: ProjectDetail = { id: 'github.com/owner/demo', kind: 'github', name: 'owner/demo', root: repo, remote: 'https://github.com/owner/demo.git', sessions: [{ sessionId: id, edits: 1, primary: true, byCwdOnly: false }], edits: 1, calls: 1, failed: 0, firstTs: s.startedAt, lastTs: s.updatedAt, live: false, gone: false, sessionList: [row], neighbours: [] };

    const md = await buildDossier(p, new Map([[id, s]]));
    expect(md).toContain('- Remote: https://github.com/owner/demo.git');
    expect(md).toContain('No `agenttrace.json` yet');
    expect(md).toContain('### 2026-09-03 · add express');
    expect(md).toContain('- Helpers: Explore');
    expect(md).toMatch(/- Commits: `[0-9a-f]+` first light/);
    expect(md).toMatch(/\| express \|/);
    expect(md).toMatch(/\| first light \| add express \|/); // the commit table names the session it was made in
    expect(md).toContain('## Evidence available');
    expect(md).toMatch(/- Commits on [\w/]+: 1, from 2026-09-03 to 2026-09-03; 0 tags/);
    expect(md).toMatch(/states a reason: 0/);
    expect(md).toContain('journal/: 1 sessions, one entry each.');
    // a record folder that already holds a same-named file in another case is flagged, never overwritten
    const rec = mkdtempSync(join(tmpdir(), 'at-dossier-rec-'));
    writeFileSync(join(rec, 'ROADMAP.md'), '# theirs\n');
    const md2 = await buildDossier({ ...p, recordRoot: rec }, new Map([[id, s]]));
    expect(md2).toContain('already holds ROADMAP.md');
    expect(md2).toContain('`agenttrace` subfolder');
  });
});
