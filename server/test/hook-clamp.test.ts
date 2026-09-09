// The hook caps payload fields before it writes them. G15: one session's log reached 129.7 MB
// because tool_response and tool_input were stored whole, and appending 649 KB lines
// synchronously made the hook exceed its own five-second timeout, losing events the Turns and
// Helpers views read. These pin the cap and, as importantly, pin what the cap must not touch.
import { describe, it, expect } from 'vitest';
import { clampEvent } from '../../hooks/log-event.mjs';
import { parseHookLog } from '../src/hooks.js';

const LIMIT = 4096;

describe('clampEvent', () => {
  it('shortens an oversized string payload and records what it was', () => {
    const original = 'x'.repeat(650_000);
    const event = clampEvent({ hook_event_name: 'PostToolUse', tool_response: original });
    expect(event.tool_response).toHaveLength(LIMIT);
    expect(event.tool_response_bytes).toBe(650_000);
    expect(event.tool_response_truncated).toBe(true);
  });

  it('shortens an oversized object payload to its JSON head', () => {
    const event = clampEvent({ tool_input: { content: 'y'.repeat(50_000), path: 'a.ts' } });
    expect(typeof event.tool_input).toBe('string');
    expect((event.tool_input as string).length).toBe(LIMIT);
    expect(event.tool_input_truncated).toBe(true);
  });

  it('leaves a small payload exactly as it was, and unflagged', () => {
    const input = { command: 'ls -la' };
    const event = clampEvent({ tool_input: input });
    expect(event.tool_input).toEqual(input);
    expect(event.tool_input_truncated).toBeUndefined();
    expect(event.tool_input_bytes).toBeUndefined();
  });

  it('never touches the fields the log exists for', () => {
    const event = clampEvent({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_use_id: 'toolu_1',
      tool_name: 'Read',
      duration_ms: 1402,
      agent_id: 'a1',
      tool_response: 'z'.repeat(10_000),
    });
    expect(event.hook_event_name).toBe('PostToolUse');
    expect(event.session_id).toBe('s1');
    expect(event.tool_use_id).toBe('toolu_1');
    expect(event.tool_name).toBe('Read');
    expect(event.duration_ms).toBe(1402);
    expect(event.agent_id).toBe('a1');
  });

  it('leaves a clamped line fully readable by the log reader', () => {
    const event = clampEvent({
      hook_event_name: 'PostToolUse',
      received_at: '2026-09-09T14:00:00.000Z',
      tool_name: 'Read',
      tool_use_id: 'toolu_2',
      duration_ms: 297,
      tool_response: 'q'.repeat(200_000),
    });
    const summary = parseHookLog(JSON.stringify(event) + '\n');
    expect(summary.durations['toolu_2']).toBe(297);
    expect(summary.counts.PostToolUse).toBe(1);
    expect(summary.events[0].toolName).toBe('Read');
  });

  it('keeps a Notification message readable, since the reader shows it', () => {
    const event = clampEvent({ hook_event_name: 'Notification', received_at: 't', message: 'Waiting for your input' });
    const summary = parseHookLog(JSON.stringify(event) + '\n');
    expect(summary.events[0].note).toBe('Waiting for your input');
  });
});
