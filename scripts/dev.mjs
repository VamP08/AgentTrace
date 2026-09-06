#!/usr/bin/env node
// Both dev servers under one command. `a & b` is a shell-ism cmd.exe does not have, so the
// two children are spawned here instead and their output is prefixed and merged.
// Anything after `--` is passed on to Vite, e.g. `npm run dev -- --port 4758`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// On Windows a .cmd shim can only be launched through the shell.
const shell = process.platform === 'win32';
const pass = process.argv.slice(2);

// shared/ is consumed as built JavaScript; without it neither child can resolve it.
if (!existsSync(join(root, 'shared', 'dist', 'index.js'))) {
  console.log('[dev] building shared');
  const cmd = ['run', 'build', '--workspace', 'shared'];
  const built = shell
    ? spawnSync([npm, ...cmd].join(' '), { cwd: root, shell: true, stdio: 'inherit' })
    : spawnSync(npm, cmd, { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

let stopping = false;

function prefix(stream, tag, out) {
  let held = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (held + chunk).split(/\r?\n/);
    held = lines.pop() ?? '';
    for (const line of lines) out.write(`[${tag}] ${line}\n`);
  });
  stream.on('end', () => {
    if (held) out.write(`[${tag}] ${held}\n`);
  });
}

function stop() {
  for (const kid of kids) {
    if (kid.exitCode !== null || kid.signalCode !== null) continue;
    // The child is a shim; killing it alone would orphan tsx/vite underneath.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(kid.pid), '/T', '/F'], { stdio: 'ignore' });
    else kid.kill('SIGTERM');
  }
}

function start(tag, args) {
  const argv = ['run', 'dev', '--workspace', tag, ...args];
  // Node warns when a shell gets a separate args array, so on Windows the line is assembled here.
  const kid = shell
    ? spawn([npm, ...argv].join(' '), { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(npm, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  prefix(kid.stdout, tag, process.stdout);
  prefix(kid.stderr, tag, process.stderr);
  kid.on('error', (e) => {
    console.error(`[${tag}] ${e.message}`);
    process.exitCode = 1;
    if (!stopping) (stopping = true), stop();
  });
  kid.on('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`[${tag}] exited (${signal ?? code}); stopping the other`);
    process.exitCode = code || 1;
    stop();
  });
  return kid;
}

const kids = [start('server', []), start('web', pass.length ? ['--', ...pass] : [])];

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    stop();
  });
}
