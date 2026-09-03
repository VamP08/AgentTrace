#!/usr/bin/env node
// Statusline wrapper: record the status JSON Claude Code pipes in, then run the original
// statusline command with the same input and print its output.
// Usage in settings.json: node statusline-tee.mjs -- <original command...>
// Output: <claude config dir>/agenttrace/status/<session_id>.jsonl
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const status = JSON.parse(raw);
    const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const dir = join(root, 'agenttrace', 'status');
    mkdirSync(dir, { recursive: true });
    const id = status.session_id || 'unknown';
    status.received_at = new Date().toISOString();
    appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify(status) + '\n');
  } catch {
    // Recording is best effort.
  }
  const sep = process.argv.indexOf('--');
  const cmd = sep >= 0 ? process.argv.slice(sep + 1) : [];
  if (cmd.length) {
    const r = spawnSync(cmd[0], cmd.slice(1), { input: raw, encoding: 'utf8', shell: false });
    process.stdout.write(r.stdout || '');
  }
  process.exit(0);
});
