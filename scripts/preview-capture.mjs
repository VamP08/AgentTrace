#!/usr/bin/env node
// Builds the LectureQA demo, starts the real server on it, and records every response the page can
// ask for into web/src/demo/snapshot.json. `npm run build:demo -w web` then bakes that snapshot into
// a static page with no server behind it: the online preview.
//
// Nothing is hand-written here: each entry is what the real server answered. Run it where the
// preview is built (render.yaml does), not on a machine whose paths you would rather not publish;
// the snapshot holds the demo folder's absolute paths.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const demo = process.argv[2] ?? join(tmpdir(), 'agenttrace-preview');
const out = join(root, 'web', 'src', 'demo', 'snapshot.json');

execFileSync(process.execPath, [join(here, 'demo.mjs'), demo, '--no-start'], { stdio: 'inherit' });

// the server reads its settings when it is imported, so they are set first
process.env.CLAUDE_CONFIG_DIR = join(demo, 'claude');
process.env.AGENTTRACE_PORT = process.env.AGENTTRACE_PORT || '4799';
const { start } = await import(pathToFileURL(join(root, 'server', 'dist', 'index.js')).href);
const base = (await start()).replace(/\/$/, '');

/** The same key the page's fetch shim computes: path, then the query sorted by name. */
function key(path) {
  const u = new URL(path, 'http://x');
  const q = new URLSearchParams([...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  return u.pathname + (q ? `?${q}` : '');
}

const routes = {};
async function get(path) {
  const r = await fetch(base + path);
  const type = r.headers.get('content-type') ?? '';
  const entry = { status: r.status };
  if (type.includes('json')) entry.json = await r.json();
  else entry.text = await r.text();
  routes[key(path)] = entry;
  return entry.json ?? entry.text;
}

// The project index is built in the background after start; wait for it to hold every session.
let projects;
for (let i = 0; i < 120; i++) {
  projects = await get('/api/projects');
  if (projects.projects?.length && projects.projects.every((p) => p.sessions.length > 0)) break;
  await new Promise((r) => setTimeout(r, 500));
}
const sessions = await get('/api/sessions');
await get('/api/setup');
await get('/api/settings');

const records = [];
for (const p of projects.projects) {
  const id = encodeURIComponent(p.id);
  await get(`/api/projects/${id}`);
  const record = await get(`/api/projects/${id}/record`);
  if (!record || record.present === false) continue;
  records.push(record);
  await get(`/api/projects/${id}/brief?format=md`);
  await get(`/api/progress?project=${encodeURIComponent(record.project)}`);
  for (const l of record.learning) {
    if (!l.files?.[0]) continue;
    await get(`/api/projects/${id}/record?${new URLSearchParams({ file: l.files[0], ...(l.anchor ? { anchor: l.anchor } : {}) })}`);
  }
  const docs = await get(`/api/projects/${id}/documents`);
  for (const d of Array.isArray(docs) ? docs : docs?.documents ?? []) {
    if (d?.path) await get(`/api/projects/${id}/documents?file=${encodeURIComponent(d.path)}`);
  }
}

for (const s of sessions) {
  const at = `/api/sessions/${s.id}`;
  await get(`${at}/events`);
  const agents = await get(`${at}/agents`);
  for (const a of agents) await get(`${at}/events?agent=${a.agentId}`);
  await get(`${at}/hooks`);
  await get(`${at}/commits`);
  await get(`${at}/digest`);
  const files = await get(`${at}/files`);
  for (const f of files) {
    for (const v of f.versions) await get(`${at}/files?backup=${encodeURIComponent(v.backup)}`);
    await get(`${at}/files?path=${encodeURIComponent(f.path)}`);
  }
}

const count = Object.keys(routes).length;
if (sessions.length < 7 || records.length < 1 || count < 60) {
  console.error(`preview capture looks wrong: ${sessions.length} sessions, ${records.length} records, ${count} routes`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), routes, records }));
console.log(`captured ${count} responses from ${sessions.length} sessions and ${records.length} record into ${out}`);
process.exit(0);
