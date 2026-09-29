#!/usr/bin/env node
// A made-up project to try AgentTrace on, with nobody's real sessions in it.
//
//   npm run demo                              build it under the system temp folder and open the app
//   node scripts/demo.mjs <dir> --no-start    build it only
//
// The project is LectureQA, a student's app that answers questions from their lecture PDFs and cites
// the page, built over seven sessions across two weeks (scripts/demo/lectureqa.mjs). Everything the
// app reads is written here in the coding tool's own formats: the transcripts, helpers' transcripts,
// the file backups, a real git repository whose commits the transcripts show being made, and a
// learning record. The app runs with CLAUDE_CONFIG_DIR pointed at the demo, so the real ~/.claude
// is never read.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './demo/lectureqa.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'agenttrace-demo'));
const start = !args.includes('--no-start');

rmSync(root, { recursive: true, force: true });
const claude = join(root, 'claude');
const repo = join(root, 'work', 'lectureqa');
const record = join(root, 'work', 'lectureqa-record');
mkdirSync(repo, { recursive: true });
mkdirSync(record, { recursive: true });

// the coding tool names a project folder after its working directory
const slug = repo.replace(/[^a-zA-Z0-9]/g, '-');
const DAY = 86_400_000;
const ID = ['-c', 'user.name=Demo Student', '-c', 'user.email=student@example.com', '-c', 'core.autocrlf=false'];

function git(...a) {
  return execFileSync('git', [...ID, ...a], { cwd: repo, encoding: 'utf8' }).trim();
}
git('init', '-q', '-b', 'main');
git('remote', 'add', 'origin', 'https://github.com/example/lectureqa.git');

function put(rel, content) {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function numbered(content) {
  return content.split('\n').map((l, i) => `${String(i + 1).padStart(5)}→${l}`).join('\n');
}

/** The smallest run of whole lines that changed, the way an Edit call carries it. */
function passage(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const from = a.lastIndexOf('\n', i - 1) + 1;
  const endA = a.indexOf('\n', a.length - j);
  const endB = b.indexOf('\n', b.length - j);
  return [a.slice(from, endA < 0 ? a.length : endA), b.slice(from, endB < 0 ? b.length : endB)];
}

/** One session's transcript, written line by line the way the coding tool writes it. */
class Transcript {
  constructor(title, at, id = randomUUID()) {
    this.id = id;
    this.title = title;
    this.t = at;
    this.lines = [];
    this.last = null;
    this.context = 18_000;
    this.dirty = new Set();
    this.versions = {}; // per session, as the tool numbers them
  }
  tick(seconds) {
    this.t += seconds * 1000;
    return new Date(this.t).toISOString();
  }
  base(type, seconds) {
    const uuid = randomUUID();
    const rec = { type, uuid, parentUuid: this.last, timestamp: this.tick(seconds), sessionId: this.id, cwd: repo, gitBranch: 'main', version: '2.1.0', entrypoint: 'cli', userType: 'external' };
    this.last = uuid;
    return rec;
  }
  usage(out) {
    this.context += 900 + out;
    return { input_tokens: 4, cache_creation_input_tokens: 900, cache_read_input_tokens: this.context, output_tokens: out };
  }
  user(content) {
    this.lines.push({ ...this.base('user', 25), message: { role: 'user', content } });
  }
  say(text, out = 450) {
    this.lines.push({ ...this.base('assistant', 9), message: { id: `msg_${randomUUID().slice(0, 12)}`, role: 'assistant', model: 'demo', content: [{ type: 'text', text }], usage: this.usage(out) } });
  }
  tool(name, input, result, { error = false, seconds = 6 } = {}) {
    const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    this.lines.push({ ...this.base('assistant', 5), message: { id: `msg_${randomUUID().slice(0, 12)}`, role: 'assistant', model: 'demo', content: [{ type: 'tool_use', id, name, input }], usage: this.usage(140) } });
    this.lines.push({ ...this.base('user', seconds), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: error }] } });
    return id;
  }
  read(rel) {
    this.tool('Read', { file_path: join(repo, rel) }, numbered(readFileSync(join(repo, rel), 'utf8')), { seconds: 2 });
  }
  /**
   * Before a session first changes a file, the tool keeps what the file held: version 1. A file the
   * session creates has no version 1 (there was nothing to keep), so its first copy is version 2.
   */
  keepBefore(rel) {
    if (rel in this.versions) return;
    const full = join(repo, rel);
    if (!existsSync(full)) {
      this.versions[rel] = 1;
      return;
    }
    this.versions[rel] = 1;
    this.backup({ [rel]: 1 });
  }
  backup(which) {
    const dir = join(claude, 'file-history', this.id);
    mkdirSync(dir, { recursive: true });
    const tracked = {};
    for (const [rel, v] of Object.entries(which)) {
      const name = `${createHash('sha1').update(rel).digest('hex').slice(0, 16)}@v${v}`;
      writeFileSync(join(dir, name), readFileSync(join(repo, rel), 'utf8'));
      tracked[join(repo, rel)] = { backupFileName: name, version: v, backupTime: new Date(this.t).toISOString() };
    }
    const messageId = randomUUID();
    this.lines.push({ type: 'file-history-snapshot', messageId, snapshot: { messageId, trackedFileBackups: tracked, timestamp: new Date(this.t).toISOString() }, isSnapshotUpdate: true });
  }
  write(rel, content) {
    this.keepBefore(rel);
    put(rel, content);
    this.tool('Write', { file_path: join(repo, rel), content }, `File created successfully at: ${join(repo, rel)}`);
    this.dirty.add(rel);
  }
  edit(rel, after) {
    this.keepBefore(rel);
    const before = readFileSync(join(repo, rel), 'utf8');
    put(rel, after);
    const [old_string, new_string] = passage(before, after);
    this.tool('Edit', { file_path: join(repo, rel), old_string, new_string }, `The file ${join(repo, rel)} has been updated successfully.`);
    this.dirty.add(rel);
  }
  grep(pattern, path, result) {
    this.tool('Grep', { pattern, path: join(repo, path), output_mode: 'content' }, result, { seconds: 2 });
  }
  bash(command, description, result, opts) {
    return this.tool('Bash', { command, description }, result, opts);
  }
  commit(subject) {
    git('add', '-A');
    const when = new Date(this.t + 4000).toISOString();
    execFileSync('git', [...ID, 'commit', '-q', '-m', subject], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    const sha = git('rev-parse', '--short', 'HEAD');
    const stat = git('show', '--stat', '--format=', 'HEAD').split('\n').pop().trim();
    this.bash(`git add -A && git commit -m "${subject}"`, 'Commit', `[main ${sha}] ${subject}\n ${stat}`);
    return sha;
  }
  /** The tool keeps a copy of every file a turn changed, as the file stood when the turn ended. */
  snapshot() {
    if (!this.dirty.size) return;
    const which = {};
    for (const rel of this.dirty) which[rel] = ++this.versions[rel];
    this.dirty.clear();
    this.backup(which);
  }
  /** A helper: the Agent call in this transcript, and the helper's own transcript beside it. */
  helper(type, description, prompt, reads, report) {
    const startAt = this.t;
    const toolId = this.tool('Agent', { subagent_type: type, description, prompt }, report, { seconds: 45 });
    const agentId = randomUUID().replace(/-/g, '').slice(0, 17);
    const dir = join(claude, 'projects', slug, this.id, 'subagents');
    mkdirSync(dir, { recursive: true });
    const sub = new Transcript('', startAt + 3000, this.id);
    sub.user(prompt);
    for (const rel of reads) sub.read(rel);
    sub.say(report, 700);
    writeFileSync(join(dir, `agent-${agentId}.jsonl`), sub.lines.map((l) => JSON.stringify({ ...l, isSidechain: true, agentId })).join('\n') + '\n');
    writeFileSync(join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: type, description, toolUseId: toolId, spawnDepth: 1 }));
  }
  /** A turn ends: back up what it changed. */
  done(text, out) {
    this.say(text, out);
    this.snapshot();
  }
  save() {
    this.snapshot();
    this.lines.push({ type: 'ai-title', sessionId: this.id, aiTitle: this.title });
    const dir = join(claude, 'projects', slug);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${this.id}.jsonl`);
    writeFileSync(file, this.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    utimesSync(file, new Date(this.t), new Date(this.t));
    return this;
  }
}


function at(daysAgo, hour, minute = 0) {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function md(rel, front, body) {
  const full = join(record, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `---\n${front.trim()}\n---\n${body.trim()}\n`);
}

const summary = build({ Transcript, at, md, put, repo, record, join });
writeFileSync(join(repo, 'agenttrace.json'), JSON.stringify({ contract: 1, project: 'LectureQA', record: '../lectureqa-record' }, null, 2) + '\n');
git('add', '-A');
execFileSync('git', [...ID, 'commit', '-q', '-m', 'Keep a learning record beside the code'], { cwd: repo });

console.log(`Demo built in ${root}`);
console.log(`  ${summary}`);

if (start) {
  const port = process.env.AGENTTRACE_PORT || '4750';
  console.log(`Starting AgentTrace on the demo at http://localhost:${port}. Your own ~/.claude is not read.`);
  const app = spawn(process.execPath, [join(here, '..', 'bin', 'agenttrace.mjs')], { stdio: 'inherit', env: { ...process.env, CLAUDE_CONFIG_DIR: claude, AGENTTRACE_PORT: port } });
  // this process only waits on the app; when the app stops, so does it
  app.on('exit', (code) => process.exit(code ?? 0));
}
