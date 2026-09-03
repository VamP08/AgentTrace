// HTTP API over the transcript files plus a WebSocket that streams new lines as they land.
// Plain node:http; the HTTP surface is four GET routes.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@agenttrace/shared';
import { discoverAgents, discoverSessions, findSession } from './discover.js';
import { archiveSession, archiveStats, livePaths } from './archive.js';
import { codeWindow, readRecord } from './docs.js';
import { commitsBetween, gitRootsFor, showCommit } from './git.js';
import { readHookLog } from './hooks.js';
import { readCurrent, readVersion, trackedFiles } from './fileHistory.js';
import { parseFile, type ParsedFile } from './parse.js';
import { detectStack } from './stack.js';
import { buildFacts, foldProjects, projectDetail } from './projects.js';
import { Tailer, type TailBatch, type TailGone } from './tail.js';

export const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const port = Number(process.env.AGENTTRACE_PORT || 4747);

// ponytail: session id -> project slug, refreshed on every list call; a full index can wait.

// No CORS headers on purpose: the page is served same-origin through Vite's proxy, and a
// wildcard here would let any website open in the browser read transcripts and source files.
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Refuse requests whose Host is not the loopback address, which blocks DNS-rebinding tricks. */
function localHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

const SESSION_ID = /^[0-9a-f-]{36}$/;

// ponytail: per-session set of technologies already reported, so live batches only add new ones.
const stackSeen = new Map<string, Set<string>>();

/** Parse the main transcript and append derived stack events; resets the live seen-set for the session. */
async function history(file: string, id: string): Promise<ParsedFile> {
  const parsed = await parseFile(file, { sessionId: id });
  const seen = new Set<string>();
  stackSeen.set(id, seen);
  parsed.events.push(...detectStack(parsed.events, seen));
  return parsed;
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const skillSource = join(repoRoot, 'skill', 'SKILL.md');
const skillTarget = join(claudeRoot, 'skills', 'agenttrace', 'SKILL.md');

/** What a new user needs to know and do: where the app reads from, what is installed, what to paste. */
function setupStatus() {
  let hooksInstalled = false;
  try {
    hooksInstalled = readFileSync(join(claudeRoot, 'settings.json'), 'utf8').includes('log-event.mjs');
  } catch {
    // no settings file yet
  }
  return {
    claudeRoot,
    projectsDir: join(claudeRoot, 'projects'),
    skillInstalled: existsSync(skillTarget),
    hooksInstalled,
    hookInstaller: join(repoRoot, 'hooks', 'install-settings.mjs'),
    snippet: [
      '# AgentTrace learning record',
      'This project keeps a record for AgentTrace. `agenttrace.json` at the repo root names the folder.',
      'Follow the `agenttrace` skill: write a learning entry when a library, pattern, algorithm, design',
      'choice or piece of math enters the code; a decision entry when options were weighed; a journal',
      'entry at the end of the session. Same turn as the code. Explain for a reader who does not program.',
    ].join('\n'),
    manifestExample: JSON.stringify({ contract: 1, project: 'YourProject', record: 'C:/path/to/your/notes/YourProject' }, null, 2),
  };
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (!localHost(req)) return json(res, 403, { error: 'local access only' });
  try {
    if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });
    if (parts[1] === 'setup' && parts.length === 2) return json(res, 200, { ...setupStatus(), archive: archiveStats(claudeRoot) });
    if (parts[1] === 'setup' && parts[2] === 'skill' && req.method === 'POST') {
      if (!existsSync(skillSource)) return json(res, 500, { error: 'skill/SKILL.md missing from the AgentTrace checkout' });
      mkdirSync(join(skillTarget, '..'), { recursive: true });
      copyFileSync(skillSource, skillTarget);
      return json(res, 200, setupStatus());
    }
    if (parts[1] === 'projects' && parts.length === 2) {
      const { facts, sessions } = await buildFacts(claudeRoot);
      return json(res, 200, foldProjects(facts, sessions));
    }
    if (parts[1] === 'projects' && (parts.length === 3 || parts.length === 4)) {
      const id = decodeURIComponent(parts[2]);
      const { facts, sessions } = await buildFacts(claudeRoot);
      const index = foldProjects(facts, sessions);
      const detail = projectDetail(id, facts, sessions, index);
      if (!detail) return json(res, 404, { error: 'unknown project' });
      if (parts.length === 3) return json(res, 200, detail);
      if (parts[3] !== 'record') return json(res, 404, { error: 'not found' });
      // The record is the repository's own: found from its root, never guessed from a session.
      const record = readRecord(detail.root, []);
      if (!record) return json(res, 200, { present: false });
      const file = url.searchParams.get('file');
      if (file) {
        const w = codeWindow(record.repoDir, file, url.searchParams.get('anchor') ?? undefined);
        return w ? json(res, 200, w) : json(res, 404, { error: 'file not found inside the project' });
      }
      return json(res, 200, record);
    }
    if (parts[1] === 'sessions' && parts.length === 2) {
      const sessions = discoverSessions(claudeRoot);
      return json(res, 200, sessions);
    }
    if (parts[1] === 'sessions' && parts.length === 4) {
      const id = parts[2];
      const session = SESSION_ID.test(id) ? findSession(claudeRoot, id) : undefined;
      if (!session) return json(res, 404, { error: 'unknown session' });
      if (parts[3] === 'agents') return json(res, 200, discoverAgents(session.dir));
      if (parts[3] === 'hooks') {
        const h = readHookLog(claudeRoot, id);
        return json(res, 200, h ?? { present: false, events: [], durations: {}, counts: {} });
      }
      if (parts[3] === 'commits') {
        if (!session.cwd) return json(res, 200, []);
        const parsed = await parseFile(session.file, { sessionId: id });
        const repos = gitRootsFor(session.cwd, trackedFiles(parsed.events, session.cwd).map((f) => f.path));
        const sha = url.searchParams.get('sha');
        if (sha) {
          for (const repo of repos) {
            const body = showCommit(repo, sha);
            if (body !== undefined) return text(res, 200, body);
          }
          return json(res, 404, { error: 'unknown commit' });
        }
        // a little slack either side: clocks and the last commit after the final line
        const since = new Date(new Date(session.startedAt).getTime() - 60_000).toISOString();
        const until = new Date(new Date(session.updatedAt).getTime() + 30 * 60_000).toISOString();
        const all = repos.flatMap((repo) => commitsBetween(repo, since, until).map((c) => ({ ...c, repo: basename(repo) })));
        return json(res, 200, all.sort((a, b) => (a.ts < b.ts ? 1 : -1)));
      }
      if (parts[3] === 'record') {
        const parsed = await parseFile(session.file, { sessionId: id });
        const touched = session.cwd ? trackedFiles(parsed.events, session.cwd).map((f) => f.path) : [];
        const record = session.cwd ? readRecord(session.cwd, touched) : undefined;
        if (!record) return json(res, 200, { present: false });
        const file = url.searchParams.get('file');
        if (file) {
          const w = codeWindow(record.repoDir, file, url.searchParams.get('anchor') ?? undefined);
          return w ? json(res, 200, w) : json(res, 404, { error: 'file not found inside the project' });
        }
        return json(res, 200, record);
      }
      if (parts[3] === 'events') {
        const agent = url.searchParams.get('agent');
        if (!agent) return json(res, 200, await history(session.file, id));
        const info = discoverAgents(session.dir).find((a) => a.agentId === agent);
        if (!info) return json(res, 404, { error: 'unknown agent' });
        return json(res, 200, await parseFile(join(session.dir, info.file), { sessionId: id, agentId: agent }));
      }
      if (parts[3] === 'files') {
        const parsed = await parseFile(session.file, { sessionId: id });
        const backup = url.searchParams.get('backup');
        const path = url.searchParams.get('path');
        if (backup) {
          const body = readVersion(session.fileHistory, backup);
          return body === undefined ? json(res, 404, { error: 'unknown version' }) : text(res, 200, body);
        }
        if (path) {
          const body = readCurrent(parsed.events, path, session.cwd);
          return body === undefined ? json(res, 404, { error: 'file not tracked or missing' }) : text(res, 200, body);
        }
        return json(res, 200, trackedFiles(parsed.events, session.cwd));
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

  wss.on('connection', (ws, req) => {
    if (!localHost(req)) return void ws.close(1008, 'local access only');
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'unsubscribe') return void wants.delete(ws);
      if (msg.type !== 'subscribe' || !SESSION_ID.test(msg.sessionId)) return;
      const session = findSession(claudeRoot, msg.sessionId);
      if (!session) return;
      wants.set(ws, msg.sessionId);
      // History first, then the live stream continues from whatever the tailer sees next.
      const h = await history(session.file, msg.sessionId);
      send(ws, { type: 'history', sessionId: msg.sessionId, events: h.events, parseErrors: h.parseErrors });
      send(ws, { type: 'agents', sessionId: msg.sessionId, agents: discoverAgents(session.dir) });
    });
    ws.on('close', () => wants.delete(ws));
  });

  tailer.on('events', (b: TailBatch) => {
    // a live session that changed is copied again, so the archive never lags by more than one batch
    archiveSession(claudeRoot, { archived: false, projectSlug: b.projectSlug, id: b.sessionId, ...livePaths(claudeRoot, b.projectSlug, b.sessionId) });
    const seen = stackSeen.get(b.sessionId);
    const events = seen && !b.agentId ? [...b.events, ...detectStack(b.events, seen)] : b.events;
    for (const [ws, sid] of wants) if (sid === b.sessionId) send(ws, { type: 'events', sessionId: b.sessionId, agentId: b.agentId, events });
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
