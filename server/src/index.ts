// HTTP API over the transcript files plus a WebSocket that streams new lines as they land.
// Plain node:http; the HTTP surface is four GET routes.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@agenttrace/shared';
import { discoverAgents, discoverSessions, sessionFile } from './discover.js';
import { parseFile } from './parse.js';
import { Tailer, type TailBatch, type TailGone } from './tail.js';

export const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const port = Number(process.env.AGENTTRACE_PORT || 4747);

// ponytail: session id -> project slug, refreshed on every list call; a full index can wait.
const slugById = new Map<string, string>();

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function slugFor(id: string): string | undefined {
  if (!slugById.has(id)) for (const s of discoverSessions(claudeRoot)) slugById.set(s.id, s.projectSlug);
  return slugById.get(id);
}

const SESSION_ID = /^[0-9a-f-]{36}$/;

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });
    if (parts[1] === 'sessions' && parts.length === 2) {
      const sessions = discoverSessions(claudeRoot);
      for (const s of sessions) slugById.set(s.id, s.projectSlug);
      return json(res, 200, sessions);
    }
    if (parts[1] === 'sessions' && parts.length === 4) {
      const id = parts[2];
      const slug = SESSION_ID.test(id) ? slugFor(id) : undefined;
      if (!slug) return json(res, 404, { error: 'unknown session' });
      if (parts[3] === 'agents') return json(res, 200, discoverAgents(claudeRoot, slug, id));
      if (parts[3] === 'events') {
        const agent = url.searchParams.get('agent');
        let file = sessionFile(claudeRoot, slug, id);
        if (agent) {
          const info = discoverAgents(claudeRoot, slug, id).find((a) => a.agentId === agent);
          if (!info) return json(res, 404, { error: 'unknown agent' });
          file = join(claudeRoot, 'projects', slug, id, info.file);
        }
        const parsed = await parseFile(file, { sessionId: id, agentId: agent ?? undefined });
        return json(res, 200, parsed);
      }
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
}

/** One subscription per socket: the session it wants, including all of that session's subagents. */
export function attachWebSocket(server: ReturnType<typeof createServer>, tailer: Tailer) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wants = new Map<WebSocket, string>();
  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'unsubscribe') return void wants.delete(ws);
      if (msg.type !== 'subscribe' || !SESSION_ID.test(msg.sessionId)) return;
      const slug = slugFor(msg.sessionId);
      if (!slug) return;
      wants.set(ws, msg.sessionId);
      // History first, then the live stream continues from whatever the tailer sees next.
      const history = await parseFile(sessionFile(claudeRoot, slug, msg.sessionId), { sessionId: msg.sessionId });
      send(ws, { type: 'history', sessionId: msg.sessionId, events: history.events, parseErrors: history.parseErrors });
      send(ws, { type: 'agents', sessionId: msg.sessionId, agents: discoverAgents(claudeRoot, slug, msg.sessionId) });
    });
    ws.on('close', () => wants.delete(ws));
  });

  tailer.on('events', (b: TailBatch) => {
    for (const [ws, sid] of wants) if (sid === b.sessionId) send(ws, { type: 'events', sessionId: b.sessionId, agentId: b.agentId, events: b.events });
  });
  tailer.on('gone', (g: TailGone) => {
    for (const [ws, sid] of wants) if (sid === g.sessionId && !g.agentId) send(ws, { type: 'sessions', sessions: discoverSessions(claudeRoot) });
  });
  return wss;
}

if (process.argv[1] && /index\.(ts|js)$/.test(process.argv[1])) {
  const server = createServer(handle);
  const tailer = new Tailer(join(claudeRoot, 'projects')).start();
  tailer.on('error', (e) => console.error('tailer', e));
  attachWebSocket(server, tailer);
  server.listen(port, '127.0.0.1', () => {
    console.log(`agenttrace server http://127.0.0.1:${port}  ws://127.0.0.1:${port}/ws  root=${claudeRoot}`);
  });
}
