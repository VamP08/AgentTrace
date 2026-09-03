#!/usr/bin/env node
// Claude Code hook: append the event JSON from stdin to one JSONL file per session.
// Registered for every hook event in settings.json. Never blocks: always exits 0.
// Output: <claude config dir>/agenttrace/hooks/<session_id>.jsonl
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(raw);
    const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const dir = join(root, 'agenttrace', 'hooks');
    mkdirSync(dir, { recursive: true });
    const id = event.session_id || process.env.CLAUDE_CODE_SESSION_ID || 'unknown';
    event.received_at = new Date().toISOString();
    appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify(event) + '\n');
  } catch {
    // A logging failure must never interrupt the session.
  }
  process.exit(0);
});
