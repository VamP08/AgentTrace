// The online preview only. There is no server behind the page: every /api request is answered
// from a snapshot the real server produced on the LectureQA demo (scripts/preview-capture.mjs).
// Search runs here, on the same index code the server uses. Anything that would change something
// is refused, because there is nothing to change.
import type { ProjectRecord } from '@agenttrace/shared';
import raw from './snapshot.json?raw';
import { buildIndex, search } from '../../../server/src/search';

interface Entry {
  status: number;
  json?: unknown;
  text?: string;
}
interface Snapshot {
  capturedAt: string | null;
  routes: Record<string, Entry>;
  records: ProjectRecord[];
}

const DAY = 86_400_000;
const snap: Snapshot = JSON.parse(raw);
export const capturedAt = snap.capturedAt;

// Every date moves forward by the whole days since the capture, so the demo reads as recent on the
// day it is opened and "the last fourteen days" is never empty. Whole days keep every time of day.
const days = snap.capturedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(snap.capturedAt)) / DAY)) : 0;
function shift(text: string): string {
  if (!days) return text;
  return text.replace(/\b(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?/g, (all, date: string, time?: string) => {
    const t = Date.parse(time ? all : `${date}T00:00:00Z`);
    if (Number.isNaN(t)) return all;
    const moved = new Date(t + days * DAY).toISOString();
    return time ? moved : moved.slice(0, 10);
  });
}

const index = buildIndex(JSON.parse(shift(JSON.stringify(snap.records))));

function key(u: URL): string {
  const q = new URLSearchParams([...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  return u.pathname + (q ? `?${q}` : '');
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const real = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return real(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (u.pathname === '/api/search') {
    return json(200, search(index, u.searchParams.get('q') ?? '', Number(u.searchParams.get('limit')) || 30, u.searchParams.get('project') || undefined));
  }
  if (method !== 'GET') {
    // a read mark or a review answer: accepted and forgotten, so the page behaves normally
    if (u.pathname === '/api/progress') return json(200, { ok: true });
    return json(405, { error: 'This is the online preview on made-up data, so nothing here can be changed or saved.' });
  }
  const hit = snap.routes[key(u)];
  if (!hit) return json(404, { error: 'not in the preview snapshot' });
  return hit.text !== undefined
    ? new Response(shift(hit.text), { status: hit.status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    : new Response(shift(JSON.stringify(hit.json)), { status: hit.status, headers: { 'content-type': 'application/json' } });
};
