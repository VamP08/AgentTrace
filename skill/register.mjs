#!/usr/bin/env node
// Register this repository's record with AgentTrace.
//
//   node register.mjs [repository root]      (defaults to the current folder)
//
// Reads agenttrace.json at the root and the origin remote, and writes one entry into
// <config dir>/agenttrace/repos.json, where <config dir> is CLAUDE_CONFIG_DIR or ~/.claude.
// The app reads that file, so it can still find the record and the repository's identity after
// the folder is moved or deleted. Safe to run again: only this repository's entry changes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const manifestFile = join(root, 'agenttrace.json');
if (!existsSync(manifestFile)) {
  console.error(`no agenttrace.json in ${root}; write it first (see the agenttrace skill)`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
if (typeof manifest.record !== 'string' || typeof manifest.project !== 'string') {
  console.error(`${manifestFile} needs "project" and "record" strings`);
  process.exit(1);
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
};

const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const file = join(claudeRoot, 'agenttrace', 'repos.json');
let reg = { version: 1, repos: {} };
try {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (raw && raw.version === 1 && raw.repos) reg = raw;
} catch {
  // first registration on this machine
}

const key = root.replace(/[\\/]+$/, '').toLowerCase();
const entry = {
  ...reg.repos[key],
  root,
  remote: git('remote', 'get-url', 'origin'),
  rootCommit: git('rev-list', '--max-parents=0', 'HEAD')?.split('\n').pop(),
  record: isAbsolute(manifest.record) ? manifest.record : resolve(root, manifest.record),
  project: manifest.project,
  seen: new Date().toISOString(),
};
for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
reg.repos[key] = entry;
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(reg, null, 2));
console.log(`registered ${entry.project}: ${root} -> ${entry.record}`);
