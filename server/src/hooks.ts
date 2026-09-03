// The hook log: one JSONL file per session under <claudeRoot>/agenttrace/hooks/, written by
// hooks/log-event.mjs. It holds what the transcript never records: tool durations, permission
// decisions, notifications, compaction, session start and end.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HookEvent {
  event: string;
  ts: string;
  toolName?: string;
  toolUseId?: string;
  durationMs?: number;
  /** anything small worth showing: notification message, permission decision, compaction trigger */
  note?: string;
  agentId?: string;
}

export interface HookSummary {
  events: HookEvent[];
  /** toolUseId -> duration in ms, from PostToolUse */
  durations: Record<string, number>;
  counts: Record<string, number>;
  sessionStart?: string;
  sessionEnd?: string;
}

const KEEP = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'StopFailure', 'PreCompact']);

export function parseHookLog(text: string): HookSummary {
  const events: HookEvent[] = [];
  const durations: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let sessionStart: string | undefined;
  let sessionEnd: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const event = String(r.hook_event_name ?? '');
    if (!KEEP.has(event)) continue;
    counts[event] = (counts[event] ?? 0) + 1;
    const ts = String(r.received_at ?? '');
    const ev: HookEvent = { event, ts };
    if (typeof r.tool_name === 'string') ev.toolName = r.tool_name;
    if (typeof r.tool_use_id === 'string') ev.toolUseId = r.tool_use_id;
    if (typeof r.agent_id === 'string') ev.agentId = r.agent_id;
    if (typeof r.duration_ms === 'number') {
      ev.durationMs = r.duration_ms;
      if (ev.toolUseId) durations[ev.toolUseId] = r.duration_ms;
    }
    if (event === 'Notification' && typeof r.message === 'string') ev.note = r.message;
    if (event === 'PreCompact' && typeof r.trigger === 'string') ev.note = r.trigger;
    if (event === 'PermissionRequest' && typeof r.tool_name === 'string') ev.note = `asked to run ${r.tool_name}`;
    if (event === 'SessionStart') sessionStart = ts;
    if (event === 'SessionEnd') sessionEnd = ts;
    events.push(ev);
  }
  return { events, durations, counts, sessionStart, sessionEnd };
}

export function readHookLog(claudeRoot: string, sessionId: string): HookSummary | undefined {
  const file = join(claudeRoot, 'agenttrace', 'hooks', `${sessionId}.jsonl`);
  if (!existsSync(file)) return undefined;
  return parseHookLog(readFileSync(file, 'utf8'));
}
