// HTTP API over the transcript files. Plain node:http; the surface is four GET routes.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents, discoverSessions, sessionFile } from './discover.js';
import { parseFile } from './parse.js';

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
      const slug = slugFor(id);
      if (!slug || !/^[0-9a-f-]{36}$/.test(id)) return json(res, 404, { error: 'unknown session' });
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

if (process.argv[1] && /index\.(ts|js)$/.test(process.argv[1])) {
  createServer(handle).listen(port, '127.0.0.1', () => {
    console.log(`agenttrace server http://127.0.0.1:${port}  root=${claudeRoot}`);
  });
}
