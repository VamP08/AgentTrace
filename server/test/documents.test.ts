import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ProjectDocument, ProjectIndex } from '@agenttrace/shared';

// The route reads whatever CLAUDE_CONFIG_DIR named when the module loaded, so it is set first.
const claudeRoot = mkdtempSync(join(tmpdir(), 'at-docs-root-'));
process.env.CLAUDE_CONFIG_DIR = claudeRoot;
const { handle } = await import('../src/index.js');

async function get(path: string): Promise<{ status: number; body: any }> {
  let status = 0;
  let body = '';
  const res = { writeHead: (s: number) => { status = s; }, end: (b?: string) => { body = b ?? ''; } } as unknown as ServerResponse;
  await handle({ url: path, method: 'GET', headers: { host: 'localhost' } } as IncomingMessage, res);
  return { status, body: body ? JSON.parse(body) : null };
}

/** A repository with documents, a notes folder holding its record, and a folder outside both. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'at-docs-repo-'));
  const notes = mkdtempSync(join(tmpdir(), 'at-docs-notes-'));
  const outside = mkdtempSync(join(tmpdir(), 'at-docs-out-'));
  const record = join(notes, 'Demo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(record, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# demo\n\nWhat this repository is.\n');
  writeFileSync(join(repo, 'PRODUCT.txt'), 'plain text\n');
  writeFileSync(join(repo, 'logo.png'), 'not text at all\n');
  writeFileSync(join(repo, 'docs', 'guide.md'), '# guide\n');
  writeFileSync(join(repo, 'agenttrace.json'), JSON.stringify({ contract: 1, project: 'Demo', record }));
  writeFileSync(join(record, 'roadmap.md'), '# the record owns this name\n');
  writeFileSync(join(record, 'handoff.md'), '# a document of the owner\n');
  writeFileSync(join(outside, 'loose.md'), '# not this project\n');

  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-09-06T05:05:00Z', GIT_COMMITTER_DATE: '2026-09-06T05:05:00Z' };
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true, env });
  g('init', '-q');
  g('config', 'user.email', 'a@b.c');
  g('config', 'user.name', 'a');
  g('add', '.');
  g('commit', '-q', '-m', 'first light');

  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const dir = join(claudeRoot, 'projects', 'slug');
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-06T05:00:00Z', cwd: repo, sessionId: id, message: { role: 'user', content: 'write the readme' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-06T05:01:00Z', cwd: repo, sessionId: id, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(repo, 'README.md'), content: '# demo\n' } }] } },
  ];
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { repo, outside };
}

const { repo, outside } = fixture();

async function projectId(): Promise<string> {
  const index: ProjectIndex = (await get('/api/projects')).body;
  const p = index.projects.find((x) => basename(x.root).toLowerCase() === basename(repo).toLowerCase());
  expect(p, 'the fixture repository is in the index').toBeDefined();
  return p!.id;
}

describe('GET /api/projects/:id/documents', () => {
  it('lists the repository documents and the notes beside the record, and never the record\'s own file names', async () => {
    const url = `/api/projects/${encodeURIComponent(await projectId())}/documents`;
    const { status, body } = await get(url);
    expect(status).toBe(200);
    const docs = body as ProjectDocument[];
    const inRepo = docs.filter((d) => d.where === 'repository').map((d) => d.label);
    expect(inRepo).toContain('README.md');
    expect(inRepo).toContain('PRODUCT.txt');
    expect(inRepo).toContain('docs/guide.md');
    expect(inRepo).not.toContain('logo.png'); // not a text extension
    expect(inRepo).not.toContain('agenttrace.json');
    const beside = docs.filter((d) => d.where === 'notes').map((d) => d.label.split('/').pop());
    expect(beside).toEqual(['handoff.md']); // roadmap.md is a record name, so it is not a document
    const readme = docs.find((d) => d.label === 'README.md')!;
    expect(readme.bytes).toBeGreaterThan(0);
    expect(readme.path).toMatch(/\/README\.md$/); // absolute, forward slashes
    expect(Date.parse(readme.modified)).toBeGreaterThan(0);
  });

  it('serves one document by its absolute path', async () => {
    const url = `/api/projects/${encodeURIComponent(await projectId())}/documents`;
    const docs = (await get(url)).body as ProjectDocument[];
    const readme = docs.find((d) => d.label === 'README.md')!;
    const { status, body } = await get(`${url}?file=${encodeURIComponent(readme.path)}`);
    expect(status).toBe(200);
    expect(body.content).toContain('What this repository is.');
    expect(body.path).toBe(readme.path);
  });

  it('refuses a path outside the roots, a traversal out of them, and a file that is not text', async () => {
    const url = `/api/projects/${encodeURIComponent(await projectId())}/documents`;
    const refused = [
      join(outside, 'loose.md'), // a real document, in no root of this project
      `${repo}/../${basename(outside)}/loose.md`, // the same file, reached by climbing out
      join(repo, 'logo.png'), // in a root, but not a text extension
    ];
    for (const file of refused) {
      const { status } = await get(`${url}?file=${encodeURIComponent(file)}`);
      expect(status, file).toBe(404);
    }
  });
});
