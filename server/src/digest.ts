// The catch-up digest for one session: what was asked, what it wrote, what it committed, and the
// reasoning it left in the record. Everything here is joined from what already exists — the
// transcript, the file backups, git, and entries whose `session:` names this session. Nothing is
// summarised by a model, because there is none.
import { statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { AgentInfo, Digest, DigestCommit, DigestEdit, DigestNote, Event, ProjectRecord, Session } from '@agenttrace/shared';
import { trackedFiles } from './fileHistory.js';

/**
 * The reader's own words, and only those. Two kinds of text arrive as a user message without a
 * person typing it: a reminder wrapped around the real prompt, which is stripped, and a whole
 * message the tool injected — a task notification, a hook's output — which opens with a tag and is
 * dropped. Counting those as things somebody asked for makes the digest lie about its first number.
 */
function prompts(events: Event[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind !== 'user' || e.agentId) continue;
    const text = e.text
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || /^<[a-z][a-z0-9-]*>/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

function clip(text: string, max = 400): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * What to call a file in the list. Inside the working directory it is the path relative to it.
 * Outside it — a session in one repository writing the record kept in another — the absolute path
 * is both long and identical for every row, so the last three segments carry the row instead. The
 * full path stays on the row as its title.
 */
function labelFor(path: string, cwd: string): string {
  const slashes = (p: string) => p.split(sep).join('/');
  if (cwd) {
    const rel = relative(cwd, path);
    if (rel && rel !== path && rel !== '..' && !rel.startsWith('..' + sep)) return slashes(rel);
  }
  const parts = slashes(path).split('/').filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : slashes(path);
}

/**
 * One row per backed-up version, oldest first. `bytes` is the size of that backup and `delta` is
 * the change since the previous version of the same file.
 *
 * ponytail: sizes, not line counts. A line count means reading and diffing every backup in the
 * session — megabytes on a long one — for a number the Files view already shows exactly. If the
 * digest ever needs +/- lines, read the backups there and cache per session.
 */
function editsOf(events: Event[], session: Session): DigestEdit[] {
  const rows: DigestEdit[] = [];
  for (const f of trackedFiles(events, session.cwd)) {
    let previous: number | undefined;
    for (const v of f.versions) {
      const bytes = sizeOf(join(session.fileHistory, v.backup));
      rows.push({
        path: f.path,
        label: labelFor(f.path, session.cwd),
        at: v.backupTime,
        version: v.version,
        bytes,
        delta: previous === undefined ? undefined : bytes - previous,
      });
      previous = bytes;
    }
  }
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.path.localeCompare(b.path)));
}

/** The same edits folded one row per file. Offered, never the default; see the note in digest.ts (shared). */
function foldEdits(edits: DigestEdit[]): Digest['files'] {
  const by = new Map<string, Digest['files'][number] & { firstBytes: number }>();
  for (const e of edits) {
    const row = by.get(e.path);
    if (!row) {
      by.set(e.path, { path: e.path, label: e.label, edits: 1, first: e.at, last: e.at, bytes: e.bytes, delta: 0, firstBytes: e.bytes });
      continue;
    }
    row.edits += 1;
    row.last = e.at;
    row.bytes = e.bytes;
    row.delta = e.bytes - row.firstBytes;
  }
  return [...by.values()]
    .map(({ firstBytes: _drop, ...row }) => row)
    .sort((a, b) => (a.first < b.first ? -1 : 1));
}

/** Record entries whose `session:` names this session: the reasoning written beside the code. */
function wroteIn(records: ProjectRecord[], sessionId: string): DigestNote[] {
  const out: DigestNote[] = [];
  for (const r of records) {
    for (const l of r.learning) if (l.session === sessionId) out.push({ kind: 'lesson', project: r.project, id: l.slug, title: l.title, summary: l.summary });
    for (const d of r.decisions) if (d.session === sessionId) out.push({ kind: 'decision', project: r.project, id: d.slug, title: d.title, summary: d.status });
    for (const j of r.journal) if (j.session === sessionId) out.push({ kind: 'journal', project: r.project, id: j.slug, title: j.summary || j.date, summary: j.milestone ?? '' });
  }
  return out;
}

export function buildDigest(
  session: Session,
  events: Event[],
  agents: AgentInfo[],
  commits: DigestCommit[],
  records: ProjectRecord[],
): Digest {
  const edits = editsOf(events, session);
  const asked = prompts(events);
  const wrote = wroteIn(records, session.id);
  const helpers = [...new Map(agents.map((a) => [`${a.agentType}:${a.description}`, { agentType: a.agentType, description: a.description }])).values()];
  const missing: string[] = [];
  if (!edits.length) missing.push('No file was written in this session, so there is nothing to list under what changed.');
  if (!commits.length) missing.push('Nothing was committed during this session.');
  if (!wrote.length) {
    missing.push(
      records.length
        ? 'No record entry names this session, so the "why" here is only what was asked.'
        : 'This project keeps no record, so the "why" here is only what was asked.',
    );
  }
  return {
    sessionId: session.id,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.updatedAt,
    live: session.live,
    cwd: session.cwd,
    asked: asked.slice(0, 8).map((t) => clip(t)),
    edits,
    files: foldEdits(edits),
    commits,
    helpers,
    wrote,
    missing,
    counts: {
      turns: asked.length,
      calls: events.filter((e) => e.kind === 'tool_call').length,
      failed: events.filter((e) => e.kind === 'tool_result' && e.isError).length,
      files: new Set(edits.map((e) => e.path)).size,
      edits: edits.length,
    },
  };
}
