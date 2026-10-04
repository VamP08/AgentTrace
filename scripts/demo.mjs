#!/usr/bin/env node
// A made-up project to try AgentTrace on, with nobody's real sessions in it.
//
//   npm run demo                              build it under the system temp folder and open the app
//   node scripts/demo.mjs <dir> --no-start    build it only
//   npm run demo -- --live                    and play the last session in as it happens, to see live mode
//
// The project is LectureQA, a student's app that answers questions from their lecture PDFs and cites
// the page, built over seven sessions across two weeks (scripts/demo/lectureqa.mjs). Everything the
// app reads is written here in the coding tool's own formats: the transcripts, helpers' transcripts,
// the file backups, a real git repository whose commits the transcripts show being made, and a
// learning record. The app runs with CLAUDE_CONFIG_DIR pointed at the demo, so the real ~/.claude
// is never read.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './demo/lectureqa.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'agenttrace-demo'));
const start = !args.includes('--no-start');
const live = args.includes('--live');

rmSync(root, { recursive: true, force: true });
const claude = join(root, 'claude');
const repo = join(root, 'work', 'lectureqa');
const record = join(root, 'work', 'lectureqa-record');
mkdirSync(repo, { recursive: true });
mkdirSync(record, { recursive: true });

// the coding tool names a project folder after its working directory
const slugOf = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');
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
  constructor(title, at, id = randomUUID(), { cwd = repo } = {}) {
    this.id = id;
    this.title = title;
    this.t = at;
    this.start = at;
    this.cwd = cwd;
    this.lines = [];
    this.last = null;
    this.context = 18_000;
    this.dirty = new Set();
    this.versions = {}; // per session, as the tool numbers them
    this.hooks = []; // what AgentTrace's hook logger would have written: timings the transcript lacks
    this.seen = new Set(); // files read or written in this session
  }
  hook(event, extra = {}) {
    this.hooks.push({ hook_event_name: event, received_at: new Date(this.t).toISOString(), session_id: this.id, ...extra });
  }
  tick(seconds) {
    this.t += seconds * 1000;
    return new Date(this.t).toISOString();
  }
  base(type, seconds) {
    const uuid = randomUUID();
    const rec = { type, uuid, parentUuid: this.last, timestamp: this.tick(seconds), sessionId: this.id, cwd: this.cwd, gitBranch: 'main', version: '2.1.0', entrypoint: 'cli', userType: 'external' };
    this.last = uuid;
    return rec;
  }
  usage(out) {
    this.context += 900 + out;
    return { input_tokens: 4, cache_creation_input_tokens: 900, cache_read_input_tokens: this.context, output_tokens: out };
  }
  user(content, seconds = 25) {
    this.lines.push({ ...this.base('user', seconds), message: { role: 'user', content } });
    this.hook('UserPromptSubmit');
  }
  say(text, out = 450) {
    this.lines.push({ ...this.base('assistant', 9), message: { id: `msg_${randomUUID().slice(0, 12)}`, role: 'assistant', model: 'demo', content: [{ type: 'text', text }], usage: this.usage(out) } });
  }
  tool(name, input, result, { error = false, seconds = 6 } = {}) {
    const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    this.lines.push({ ...this.base('assistant', 5), message: { id: `msg_${randomUUID().slice(0, 12)}`, role: 'assistant', model: 'demo', content: [{ type: 'tool_use', id, name, input }], usage: this.usage(140) } });
    this.hook('PreToolUse', { tool_name: name, tool_use_id: id });
    this.lines.push({ ...this.base('user', seconds), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: error }] } });
    this.context += Math.round(String(result).length / 4); // the model reads every result on its next reply
    // a little under the gap to the next line: the tool finished just before its result was written
    this.hook(error ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: name, tool_use_id: id, duration_ms: Math.max(40, Math.round(seconds * 1000 * 0.93)) });
    return id;
  }
  todo(items) {
    // items: [text, 'pending' | 'in_progress' | 'completed']
    const todos = items.map(([content, status]) => ({ content, status, activeForm: content }));
    this.tool('TodoWrite', { todos }, 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.', { seconds: 1 });
  }
  glob(pattern, result) {
    this.tool('Glob', { pattern, path: this.cwd }, result, { seconds: 1 });
  }
  read(rel) {
    this.seen.add(rel);
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
    this.seen.add(rel);
    this.keepBefore(rel);
    put(rel, content);
    this.tool('Write', { file_path: join(repo, rel), content }, `File created successfully at: ${join(repo, rel)}`);
    this.dirty.add(rel);
  }
  edit(rel, after) {
    // the tool refuses to edit a file it has not read in this session, so it always reads first
    if (!this.seen.has(rel)) this.read(rel);
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
  /** What the tool does before touching anything in a session: recent history and the files there are. */
  orient() {
    let log = '';
    try {
      log = git('log', '--oneline', '-5');
    } catch {
      log = 'fatal: your current branch does not have any commits yet';
    }
    this.bash('git log --oneline -5', 'See recent commits', log || '(no commits yet)', { seconds: 1 });
    const files = git('ls-files', '--', '*.py', '*.tsx', '*.ts').split('\n').filter(Boolean).join('\n');
    this.glob('**/*.{py,ts,tsx}', files || 'No files found');
  }
  commit(subject) {
    // every command below runs against the demo's real repository, so its output is real
    this.bash('git status --short', 'See what changed', git('status', '--short') || '(nothing to commit)', { seconds: 1 });
    git('add', '-A');
    this.bash('git add -A && git diff --cached --stat', 'Review what will be committed', git('diff', '--cached', '--stat'), { seconds: 1 });
    const when = new Date(this.t + 4000).toISOString();
    execFileSync('git', [...ID, 'commit', '-q', '-m', subject], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    const sha = git('rev-parse', '--short', 'HEAD');
    const stat = git('show', '--stat', '--format=', 'HEAD').split('\n').pop().trim();
    this.bash(`git commit -m "${subject}"`, 'Commit', `[main ${sha}] ${subject}\n ${stat}`);
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
  helper(type, description, prompt, reads, report, { greps = [], notes = [] } = {}) {
    const startAt = this.t;
    const agentId = randomUUID().replace(/-/g, '').slice(0, 17);
    this.hook('SubagentStart', { agent_id: agentId });
    const toolId = this.tool('Agent', { subagent_type: type, description, prompt }, report, { seconds: 30 + 8 * (reads.length + greps.length) });
    this.hook('SubagentStop', { agent_id: agentId });
    const dir = join(claude, 'projects', slugOf(this.cwd), this.id, 'subagents');
    mkdirSync(dir, { recursive: true });
    const sub = new Transcript('', startAt + 3000, this.id);
    sub.user(prompt);
    for (const n of notes) sub.say(n, 120);
    for (const rel of reads) sub.read(rel);
    for (const [pattern, path, result] of greps) sub.grep(pattern, path, result);
    sub.say(report, 700);
    writeFileSync(join(dir, `agent-${agentId}.jsonl`), sub.lines.map((l) => JSON.stringify({ ...l, isSidechain: true, agentId })).join('\n') + '\n');
    writeFileSync(join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: type, description, toolUseId: toolId, spawnDepth: 1 }));
  }
  /** The person runs /compact: the conversation so far is swapped for a summary, and the context drops. */
  compact(summary, kept = 21_000) {
    this.lines.push({ ...this.base('user', 40), message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>' } });
    this.hook('PreCompact', { trigger: 'manual' });
    this.lines.push({ ...this.base('system', 35), subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info', compactMetadata: { trigger: 'manual', preTokens: this.context } });
    this.lines.push({ ...this.base('user', 1), isCompactSummary: true, message: { role: 'user', content: `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:\n${summary}` } });
    this.context = kept;
  }
  /** A turn ends: back up what it changed. */
  done(text, out) {
    this.say(text, out);
    this.snapshot();
    this.hook('Stop');
  }
  /**
   * Writes the transcript and its hook log where the app looks for them. A live session is held
   * back instead, under <demo>/live, and replay() writes it line by line, so it is still running.
   */
  save({ live = false } = {}) {
    this.snapshot();
    const title = { type: 'ai-title', sessionId: this.id, aiTitle: this.title };
    if (live) this.lines.splice(1, 0, title);
    else this.lines.push(title);
    const file = join(claude, 'projects', slugOf(this.cwd), `${this.id}.jsonl`);
    const hooks = join(claude, 'agenttrace', 'hooks', `${this.id}.jsonl`);
    const all = [{ hook_event_name: 'SessionStart', received_at: new Date(this.start).toISOString(), session_id: this.id, source: 'startup' }, ...this.hooks];
    if (!live) all.push({ hook_event_name: 'SessionEnd', received_at: new Date(this.t + 2000).toISOString(), session_id: this.id });
    const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    if (live) {
      const held = join(root, 'live');
      mkdirSync(held, { recursive: true });
      writeFileSync(join(held, 'session.jsonl'), jsonl(this.lines));
      writeFileSync(join(held, 'hooks.jsonl'), jsonl(all));
      writeFileSync(join(held, 'target.json'), JSON.stringify({ transcript: file, hooks }));
      return this;
    }
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(dirname(hooks), { recursive: true });
    writeFileSync(file, jsonl(this.lines));
    utimesSync(file, new Date(this.t), new Date(this.t));
    writeFileSync(hooks, jsonl(all));
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

/**
 * Plays the held-back session into the app's folders the way the coding tool writes it: one line at
 * a time, stamped with the time it is written. Gaps are the recorded ones, a quarter as long and
 * between 0.4 and 3 seconds, so the session stays live (written to in the last 30 s) throughout.
 */
async function replay() {
  const held = join(root, 'live');
  const { transcript, hooks } = JSON.parse(readFileSync(join(held, 'target.json'), 'utf8'));
  const rows = (f) => readFileSync(join(held, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lines = rows('session.jsonl');
  const events = rows('hooks.jsonl');
  mkdirSync(dirname(transcript), { recursive: true });
  mkdirSync(dirname(hooks), { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = NaN;
  let h = 0;
  for (const rec of lines) {
    const t = Date.parse(rec.timestamp ?? rec.snapshot?.timestamp ?? '');
    if (t > last) await sleep(Math.min(3000, Math.max(400, (t - last) / 4)));
    if (Number.isFinite(t)) last = t;
    const now = new Date().toISOString();
    if (rec.timestamp) rec.timestamp = now;
    if (rec.snapshot) {
      rec.snapshot.timestamp = now;
      for (const b of Object.values(rec.snapshot.trackedFileBackups)) b.backupTime = now;
    }
    for (; h < events.length && Date.parse(events[h].received_at) <= last; h++) appendFileSync(hooks, JSON.stringify({ ...events[h], received_at: now }) + '\n');
    appendFileSync(transcript, JSON.stringify(rec) + '\n');
  }
  for (; h < events.length; h++) appendFileSync(hooks, JSON.stringify({ ...events[h], received_at: new Date().toISOString() }) + '\n');
}

const summary = build({ Transcript, at, md, put, repo, record, join, root, live });
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
  if (live) {
    console.log('The last session starts in a few seconds and runs for about two minutes. Open it while it is live.');
    setTimeout(() => replay().then(() => console.log('The live session has finished.')), 4000);
  }
} else if (live) {
  console.log(`The live session is held in ${join(root, 'live')}; it plays only when the app is started here.`);
}
