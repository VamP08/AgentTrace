// One transcript line in, zero or more typed events out. Never throws on a line: anything that
// fails to parse becomes a raw event with the error, so the viewer can show that it exists.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  Event,
  RawEvent,
  SnapshotEvent,
  ToolResultEvent,
  UsageEvent,
} from '@agenttrace/shared';

export interface ParseContext {
  sessionId: string;
  agentId?: string;
}

type Block = Record<string, any>;

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: Block) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: Block) => b.text)
    .join('\n');
}

function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((b: Block) => b && b.type === 'image').length;
}

export function parseLine(line: string, ctx: ParseContext): Event[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let rec: Block;
  try {
    rec = JSON.parse(trimmed);
  } catch (e) {
    return [
      {
        kind: 'raw',
        id: `parse-error:${hash(trimmed)}`,
        ts: '',
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        type: 'parse_error',
        error: (e as Error).message,
      },
    ];
  }
  return parseRecord(rec, ctx);
}

export function parseRecord(rec: Block, ctx: ParseContext): Event[] {
  const base = {
    ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
    sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : ctx.sessionId,
    agentId: typeof rec.agentId === 'string' ? rec.agentId : ctx.agentId,
    parentUuid: typeof rec.parentUuid === 'string' ? rec.parentUuid : undefined,
  };
  const id: string = typeof rec.uuid === 'string' ? rec.uuid : `${rec.type}:${hash(JSON.stringify(rec))}`;
  const out: Event[] = [];

  switch (rec.type) {
    case 'user': {
      const content = rec.message?.content;
      if (rec.isCompactSummary || rec.isMeta) {
        out.push({ ...base, kind: 'context', id, source: rec.isCompactSummary ? 'compact_summary' : 'meta', content: blockText(content) });
        break;
      }
      const text = blockText(content);
      const images = countImages(content);
      if (text || images) out.push({ ...base, kind: 'user', id, text, images });
      if (Array.isArray(content)) {
        content.forEach((b: Block, i: number) => {
          if (b?.type !== 'tool_result') return;
          const ev: ToolResultEvent = {
            ...base,
            kind: 'tool_result',
            id: `${id}:${i}`,
            toolUseId: String(b.tool_use_id ?? ''),
            content: typeof b.content === 'string' ? b.content : blockText(b.content),
            isError: b.is_error === true,
          };
          out.push(ev);
        });
      }
      break;
    }
    case 'assistant': {
      const msg = rec.message ?? {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      content.forEach((b: Block, i: number) => {
        if (!b) return;
        if (b.type === 'text' && b.text) out.push({ ...base, kind: 'assistant_text', id: `${id}:${i}`, text: b.text });
        if (b.type === 'tool_use') {
          out.push({ ...base, kind: 'tool_call', id: `${id}:${i}`, toolUseId: String(b.id ?? ''), name: String(b.name ?? ''), input: b.input });
          if (b.name === 'Agent' && b.input) {
            out.push({
              ...base,
              kind: 'agent_spawn',
              id: `${id}:${i}:spawn`,
              toolUseId: String(b.id ?? ''),
              agentType: String(b.input.subagent_type ?? 'general-purpose'),
              description: String(b.input.description ?? ''),
              brief: String(b.input.prompt ?? ''),
            });
          }
        }
        // thinking blocks carry no text in the transcript; nothing to show.
      });
      if (msg.usage && typeof msg.id === 'string') {
        const u = msg.usage;
        const ev: UsageEvent = {
          ...base,
          kind: 'usage',
          id: `${msg.id}:usage`,
          model: String(msg.model ?? ''),
          input: num(u.input_tokens),
          cacheRead: num(u.cache_read_input_tokens),
          cacheWrite: num(u.cache_creation_input_tokens),
          output: num(u.output_tokens),
        };
        out.push(ev);
      }
      break;
    }
    case 'attachment': {
      const a = rec.attachment ?? {};
      const source = [a.type, a.hookName].filter(Boolean).join(':') || 'attachment';
      const content = typeof a.content === 'string' ? a.content : a.stderr || a.stdout || JSON.stringify(a);
      out.push({ ...base, kind: 'context', id, source, content: String(content ?? '') });
      break;
    }
    case 'file-history-snapshot': {
      const files: SnapshotEvent['files'] = {};
      const tracked = rec.snapshot?.trackedFileBackups ?? {};
      for (const [path, v] of Object.entries<Block>(tracked)) {
        if (!v || typeof v.backupFileName !== 'string') continue;
        files[path] = { backup: v.backupFileName, version: num(v.version), backupTime: String(v.backupTime ?? '') };
      }
      out.push({ ...base, kind: 'snapshot', id: `${id}:snapshot`, files });
      break;
    }
    default: {
      const data: Record<string, unknown> = {};
      for (const k of ['aiTitle', 'lastPrompt', 'mode', 'subtype', 'customTitle']) if (k in rec) data[k] = rec[k];
      const ev: RawEvent = { ...base, kind: 'raw', id, type: String(rec.type ?? 'unknown') };
      if (Object.keys(data).length) ev.data = data;
      out.push(ev);
    }
  }
  return out;
}

export interface ParsedFile {
  events: Event[];
  parseErrors: number;
}

/** Stream a transcript line by line; a 25MB file never sits in memory as one string. */
export async function parseFile(path: string, ctx: ParseContext): Promise<ParsedFile> {
  const events: Event[] = [];
  let parseErrors = 0;
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    for (const ev of parseLine(line, ctx)) {
      if (ev.kind === 'raw' && ev.type === 'parse_error') parseErrors++;
      events.push(ev);
    }
  }
  return { events, parseErrors };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ponytail: 32-bit string hash for synthetic ids; collisions only matter for parse-error rows.
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
