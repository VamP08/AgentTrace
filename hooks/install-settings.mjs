#!/usr/bin/env node
// Register the AgentTrace loggers in ~/.claude/settings.json.
// Backs up the file first, adds the log-event hook to every event, wraps the status line.
// Safe to run twice: existing entries are not duplicated. Undo: restore the backup it prints.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const file = join(root, 'settings.json');
const backup = `${file}.bak-${Date.now()}`;
copyFileSync(file, backup);

const s = JSON.parse(readFileSync(file, 'utf8'));
const logCmd = `node "${join(here, 'log-event.mjs').replace(/\\/g, '/')}"`;
const teeCmd = `node "${join(here, 'statusline-tee.mjs').replace(/\\/g, '/')}"`;
const events = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
  'Notification', 'Stop', 'StopFailure', 'PreCompact',
];

s.hooks = s.hooks || {};
for (const e of events) {
  s.hooks[e] = s.hooks[e] || [];
  if (!JSON.stringify(s.hooks[e]).includes('log-event.mjs')) {
    s.hooks[e].push({ hooks: [{ type: 'command', command: logCmd, timeout: 5 }] });
  }
}

if (s.statusLine && s.statusLine.type === 'command' && !s.statusLine.command.includes('statusline-tee')) {
  s.statusLine.command = `${teeCmd} -- ${s.statusLine.command}`;
} else if (!s.statusLine) {
  s.statusLine = { type: 'command', command: teeCmd };
}

writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
console.log(`updated ${file}`);
console.log(`backup  ${backup}`);
console.log(`hooks   ${events.length} events -> ${logCmd}`);
console.log(`status  ${s.statusLine.command}`);
