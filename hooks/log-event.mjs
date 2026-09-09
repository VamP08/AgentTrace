#!/usr/bin/env node
// Claude Code hook: append the event JSON from stdin to one JSONL file per session.
// Registered for every hook event in settings.json. Never blocks: always exits 0.
// Output: <claude config dir>/agenttrace/hooks/<session_id>.jsonl
//
// Payload fields are capped before writing, because they are a second copy of something the
// transcript already holds. Measured on this machine before the cap: one session's log was
// 129.7 MB over 17,215 lines, of which tool_response was 101.4 MB and tool_input 16.3 MB, with
// single lines reaching 649 KB. Appending those synchronously is what made this hook exceed its
// own five-second timeout 29 times across the logs here, and a cancelled hook is a silently
// missing event in the Turns and Helpers views. What only this log holds is timing, permission
// decisions and lifecycle; tool_use_id joins every line back to the full payload in the
// transcript, and to tool-results/<tool_use_id>.txt when the result was too large for it.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bytes kept per payload field. Enough for a command, a path, or the head of a result. */
const FIELD_LIMIT = 4096;

/** Fields that carry a payload rather than a fact about the event. */
const PAYLOAD_FIELDS = ['tool_input', 'tool_response', 'prompt', 'message'];

/** Stop waiting for stdin well inside the hook timeout configured in settings.json. */
const STDIN_DEADLINE_MS = 2000;

/**
 * Shorten every payload field over the limit, in place, and say so on the event.
 * A truncated field keeps its head and gains `<field>_bytes` and `<field>_truncated`, so a
 * reader can tell a short value from a shortened one instead of guessing.
 */
export function clampEvent(event, limit = FIELD_LIMIT) {
  for (const field of PAYLOAD_FIELDS) {
    const value = event[field];
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= limit) continue;
    event[field] = text.slice(0, limit);
    event[`${field}_bytes`] = text.length;
    event[`${field}_truncated`] = true;
  }
  return event;
}

/** Append one event. Returns nothing and throws nothing: a logging failure is not the session's problem. */
function record(raw, stdinTruncated) {
  try {
    const event = JSON.parse(raw);
    const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const dir = join(root, 'agenttrace', 'hooks');
    mkdirSync(dir, { recursive: true });
    const id = event.session_id || process.env.CLAUDE_CODE_SESSION_ID || 'unknown';
    clampEvent(event);
    event.received_at = new Date().toISOString();
    if (stdinTruncated) event.stdin_truncated = true;
    appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify(event) + '\n');
  } catch {
    // A logging failure must never interrupt the session.
  }
}

// Only run when spawned as the hook itself, so the clamp can be tested without writing anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = '';
  let done = false;
  const finish = (stdinTruncated) => {
    if (done) return;
    done = true;
    record(raw, stdinTruncated);
    process.exit(0);
  };
  // If stdin never ends, write what arrived rather than sitting until the hook is cancelled.
  const deadline = setTimeout(() => finish(true), STDIN_DEADLINE_MS);
  deadline.unref?.();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('error', () => finish(true));
  process.stdin.on('end', () => {
    clearTimeout(deadline);
    finish(false);
  });
}
