// A dossier: what the app knows about one repository, as Markdown, for a coding session that is
// writing the record after the fact. Computed from the index, the archived transcripts and git.
// Nothing is inferred; every line names the session or commit it comes from, and the opening
// section says which evidence exists so the skill can decide which documents it may write.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { STACK, type ProjectDetail, type ProjectRecord, type Session } from '@agenttrace/shared';
import { discoverAgents } from './discover.js';
import { defaultBranch } from './git.js';
import { trackedFiles } from './fileHistory.js';
import { parseFile } from './parse.js';
import { detectStack } from './stack.js';

/** A commit made within this long after a session's last line still belongs to it (same rule as the timeline). */
const AFTER_MS = 30 * 60 * 1000;
const MAX_COMMITS = 300;
const MAX_REASONED = 60;
/** Names the record contract owns; a file of the same name in any letter case in the chosen folder is a clash. */
const RECORD_NAMES = ['roadmap.md', 'stack.md', 'architecture.md', 'design.md', 'gaps.md', 'learning', 'decisions', 'journal'];
/** Words that mark a commit message as stating a reason, not only a change. */
const REASON = /\b(because|so that|instead of|rather than|in order to|to avoid|otherwise|the reason|why)\b/i;

interface LogLine {
  sha: string;
  date: string;
  subject: string;
  body: string;
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
}

/** Every commit on the branch, oldest first, with its body, so reasons stated in messages can be found. */
function commitLog(root: string, branch: string): LogLine[] {
  const raw = git(root, ['log', branch, '--no-merges', '--date=iso-strict', '--format=%h%x1f%ad%x1f%s%x1f%b%x1e']);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((rec) => rec.replace(/^\s+/, '').split('\x1f'))
    .filter((f) => f.length === 4)
    .map(([sha, date, subject, body]) => ({ sha, date, subject, body: body.trim() }))
    .reverse();
}

function tags(root: string): string[] {
  const raw = git(root, ['tag', '--list', '--sort=creatordate', '--format=%(refname:short) %(creatordate:short)']);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function inside(root: string, p: string): boolean {
  const a = resolve(p).toLowerCase();
  const b = resolve(root).toLowerCase();
  return a === b || a.startsWith(b + '\\') || a.startsWith(b + '/');
}

function day(ts: string): string {
  return ts ? ts.slice(0, 10) : '?';
}

function span(a: string, b: string): string {
  const ms = Date.parse(b) - Date.parse(a);
  if (!(ms > 0)) return '';
  return ms < 3.6e6 ? `${Math.round(ms / 6e4)} min` : `${(ms / 3.6e6).toFixed(1)} h`;
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function topLevel(root: string): string[] {
  return names(root).filter((n) => n !== '.git' && n !== 'node_modules').slice(0, 40);
}

/** Text documents at the root and one level under docs/, the documents a backfill may cite. */
function documents(root: string): string[] {
  const out: string[] = [];
  for (const dir of [root, join(root, 'docs')]) {
    for (const n of names(dir)) {
      const full = join(dir, n);
      try {
        if (/\.(md|rst|txt)$/i.test(n) && statSync(full).isFile()) out.push(relative(root, full).replace(/\\/g, '/'));
      } catch {
        // vanished between listing and stat
      }
    }
  }
  return out.slice(0, 40);
}

/** Folders or files at the root or under docs/ whose name says they hold decisions. */
function decisionSources(root: string): string[] {
  const out: string[] = [];
  for (const dir of [root, join(root, 'docs')]) {
    for (const n of names(dir)) if (/decision|\badr\b|adrs?$/i.test(n)) out.push(relative(root, join(dir, n)).replace(/\\/g, '/'));
  }
  return out;
}

/** Files in the chosen record folder that a record file would overwrite on a case-insensitive disk. */
function clashes(recordRoot: string): string[] {
  return names(recordRoot).filter((n) => RECORD_NAMES.includes(n.toLowerCase()) && !RECORD_NAMES.includes(n));
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

export async function buildDossier(p: ProjectDetail, sessions: Map<string, Session>, record?: ProjectRecord): Promise<string> {
  const out: string[] = [];
  const present = existsSync(p.root);
  const branch = present ? defaultBranch(p.root) : '';
  const commits = present ? commitLog(p.root, branch) : [];
  const tagList = present ? tags(p.root) : [];
  const docs = present ? documents(p.root) : [];
  const decisionDocs = present ? decisionSources(p.root) : [];
  const statusLogs = docs.filter((d) => /progress|changelog|journal|status|history/i.test(d));
  const reasoned = commits.filter((c) => c.body.length > 0 || REASON.test(c.subject));
  const list = [...p.sessionList].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const recordDir = p.recordRoot && !p.recordMissing ? p.recordRoot : undefined;
  const clash = recordDir ? clashes(recordDir) : [];

  out.push(`# ${p.name}`, '');
  out.push(
    `Produced by AgentTrace on ${new Date().toISOString().slice(0, 10)} from ${list.length} archived session${list.length === 1 ? '' : 's'}` +
      `${commits.length ? ` and ${commits.length} commits on ${branch}` : ''}. Nothing below is inferred: every line names the session or commit it comes from. Read it, then write the record from it.`,
    '',
  );

  // What exists decides which record documents may be written; the skill's backfill table reads this first.
  out.push('## Evidence available', '');
  out.push(`- Archived sessions: ${list.length}${list.length ? ` (${day(list[0].startedAt)} to ${day(list[list.length - 1].updatedAt)})` : ''}`);
  if (present) {
    out.push(`- Commits on ${branch}: ${commits.length}${commits.length ? `, from ${day(commits[0].date)} to ${day(commits[commits.length - 1].date)}` : ''}; ${tagList.length} tags${tagList.length ? ` (${tagList.slice(0, 20).join(', ')})` : ''}`);
    out.push(`- Commits whose message states a reason: ${reasoned.length}${reasoned.length ? ' (listed at the end)' : ''}`);
    out.push(`- Documents already in the repository: ${docs.length ? docs.join(', ') : 'none'}`);
    out.push(`- Decision records found: ${decisionDocs.length ? decisionDocs.join(', ') : 'none'}`);
    out.push(`- Dated status log found: ${statusLogs.length ? statusLogs.join(', ') : 'none'}`);
  } else out.push('- Working copy not on disk: no commits, tags or documents can be read.');
  out.push('', 'What that allows, per record document:', '');
  out.push(`- stack.md, architecture.md, learning/: ${present ? 'from the working copy.' : 'not writable, the working copy is gone.'}`);
  const sequence = commits.length > 1 || list.length > 0 || tagList.length > 0 || statusLogs.length > 0;
  out.push(`- roadmap.md: ${sequence ? `a sequence exists (${commits.length} dated commits, ${list.length} sessions, ${tagList.length} tags${statusLogs.length ? `, ${statusLogs.join(', ')}` : ''}).` : 'no sequence: one milestone "as found", and say the order of work is unknown.'}`);
  const decisionEvidence = reasoned.length > 0 || decisionDocs.length > 0 || list.length > 0;
  out.push(`- decisions/: ${decisionEvidence ? `sources exist (${reasoned.length} commits with a stated reason${decisionDocs.length ? `, ${decisionDocs.join(', ')}` : ''}${list.length ? `, ${list.length} sessions` : ''}); write only what they state.` : 'no stated reason anywhere: write none, list the unexplained choices in gaps.md.'}`);
  out.push(`- journal/: ${list.length ? `${list.length} sessions, one entry each.` : statusLogs.length ? `no sessions; entries may cite ${statusLogs.join(', ')}.` : 'no sessions and no dated log: write none.'}`);
  out.push('');

  out.push('## Repository', '');
  out.push(`- Remote: ${p.remote ?? 'none'}`);
  out.push(`- Working copy: \`${p.root}\` (${present ? 'present' : 'not on disk'})`);
  if (present) out.push(`- Default branch: ${branch}, ${commits.length} commits`);
  if (present) out.push(`- Top-level entries: ${topLevel(p.root).join(', ') || 'none'}`);
  out.push('');

  out.push('## Record', '');
  if (!p.recordRoot) out.push('- No `agenttrace.json` yet: the record has not been started.');
  else if (p.recordMissing) out.push(`- Record named at \`${p.recordRoot}\`, but that folder is not on disk.`);
  else {
    out.push(`- Record at \`${p.recordRoot}\``);
    if (clash.length) out.push(`- Warning: that folder already holds ${clash.join(', ')}, which a record file would overwrite on a case-insensitive disk. Put the record in an \`agenttrace\` subfolder and name it in \`agenttrace.json\`.`);
    if (record) {
      const has = (d?: unknown) => (d ? 'written' : 'not written');
      out.push(`- roadmap.md ${has(record.roadmap)}, stack.md ${has(record.stack)}, architecture.md ${has(record.architecture)}, design.md ${has(record.design)}, gaps.md ${has(record.gaps)}`);
      out.push(`- ${record.learning.length} lessons, ${record.decisions.length} decisions, ${record.journal.length} journal entries`);
    }
  }
  out.push('');

  // One parse per session feeds the stack table and the per-session digest.
  const seen = new Set<string>();
  const stack: { tech: string; ts: string; evidence: string; session: string }[] = [];
  const digests: string[] = [];
  const windows: { start: number; end: number; title: string }[] = [];
  for (const row of list) {
    const s = sessions.get(row.id);
    if (!s) continue;
    const parsed = await parseFile(s.file, { sessionId: s.id });
    for (const e of detectStack(parsed.events, seen)) stack.push({ tech: e.tech, ts: e.ts, evidence: e.evidence, session: row.title });
    const files = trackedFiles(parsed.events, s.cwd)
      .filter((f) => inside(p.root, f.path))
      .sort((a, b) => b.versions.length - a.versions.length);
    const helpers = new Map<string, number>();
    for (const a of discoverAgents(s.dir)) helpers.set(a.agentType, (helpers.get(a.agentType) ?? 0) + 1);
    const start = row.startedAt || s.startedAt;
    const end = row.updatedAt || s.updatedAt;
    const w = { start: Date.parse(start), end: Date.parse(end) + AFTER_MS, title: row.title };
    windows.push(w);
    const made = commits.filter((c) => {
      const t = Date.parse(c.date);
      return t >= w.start && t <= w.end;
    });
    const lines = [
      `### ${day(start)} · ${row.title}`,
      '',
      `- Session \`${s.id}\`, ran in \`${s.cwd}\`${span(start, end) ? `, ${span(start, end)}` : ''}; ${row.calls} tool calls, ${row.failed} failed; ` +
        (row.byCwdOnly ? 'wrote nothing here' : `${row.edits} writes here${row.primary ? '' : ', mainly elsewhere'}`),
    ];
    if (files.length) {
      const shown = files.slice(0, 12).map((f) => `${relative(p.root, f.path).replace(/\\/g, '/')} (${f.versions.length} version${f.versions.length === 1 ? '' : 's'})`);
      lines.push(`- Files: ${shown.join(', ')}${files.length > 12 ? `, and ${files.length - 12} more` : ''}`);
    }
    if (helpers.size) lines.push(`- Helpers: ${[...helpers.entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')}`);
    if (made.length) lines.push(`- Commits: ${made.map((c) => `\`${c.sha}\` ${c.subject}`).join('; ')}`);
    digests.push(lines.join('\n'));
  }

  out.push('## Stack seen in the sessions', '');
  if (!stack.length) out.push('Nothing detected: no dependency file, import or config file was written in an archived session.');
  else {
    out.push('| Technology | Category | First seen | Session | Evidence |', '|---|---|---|---|---|');
    for (const s of stack.sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
      const cat = (STACK as Record<string, { category?: string }>)[s.tech]?.category ?? '';
      out.push(`| ${s.tech} | ${cat} | ${day(s.ts)} | ${escapeCell(s.session)} | ${escapeCell(s.evidence).slice(0, 80)} |`);
    }
    if (record) {
      const covered = new Set<string>();
      for (const l of record.learning) {
        covered.add(l.slug.toLowerCase());
        for (const t of l.tags) covered.add(t.toLowerCase());
      }
      const missing = stack.map((s) => s.tech).filter((t) => !covered.has(t.toLowerCase()));
      out.push('', missing.length ? `Lessons missing for: ${missing.join(', ')}.` : 'Every technology above has a lesson.');
    }
  }
  out.push('');

  out.push('## Sessions, oldest first', '');
  if (!digests.length) out.push('No archived session worked in this repository.');
  else out.push(digests.join('\n\n'));
  out.push('');

  if (present) {
    const owner = (c: LogLine) => {
      const t = Date.parse(c.date);
      return windows.find((w) => t >= w.start && t <= w.end)?.title ?? 'before or between the sessions';
    };
    const rows = commits.slice(-MAX_COMMITS);
    out.push(`## Commits on ${branch}, oldest first`, '');
    if (!rows.length) out.push('No commits.');
    else {
      if (commits.length > rows.length) out.push(`The last ${rows.length} of ${commits.length}.`, '');
      out.push('| Date | Commit | Subject | Session |', '|---|---|---|---|');
      for (const c of rows) out.push(`| ${day(c.date)} | \`${c.sha}\` | ${escapeCell(c.subject)} | ${escapeCell(owner(c))} |`);
    }
    out.push('');

    // The only place a commit can state a reason is its message; these are the decision candidates.
    out.push('## Commit messages that state a reason', '');
    if (!reasoned.length) out.push('None: no commit message on this branch has a body or gives a reason. Decisions cannot be written from the history alone.');
    else {
      const shown = reasoned.slice(-MAX_REASONED);
      if (reasoned.length > shown.length) out.push(`The last ${shown.length} of ${reasoned.length}.`, '');
      for (const c of shown) {
        out.push(`- \`${c.sha}\` ${day(c.date)} ${c.subject}`);
        if (c.body) out.push(`  ${c.body.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}
