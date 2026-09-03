// A dossier: what the app knows about one repository, as Markdown, for a coding session that is
// writing the record after the fact. Computed from the index, the archived transcripts and git.
// Nothing is inferred; every line names the session or commit it comes from, and the opening
// section says which evidence exists so the skill can decide which documents it may write.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { STACK, type ProjectDetail, type ProjectRecord, type Session } from '@agenttrace/shared';
import { archivedCommits } from './archive.js';
import { discoverAgents } from './discover.js';
import { defaultBranch } from './git.js';
import { trackedFiles } from './fileHistory.js';
import { parseFile } from './parse.js';
import { commitsMade } from './projects.js';
import { detectStack, stackInTree } from './stack.js';

/** A commit made within this long after a line of the session still belongs to it (same rule as the timeline). */
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

/** What one session contributes to the commit join: the hashes its transcript shows, and when it was active. */
interface Window {
  title: string;
  shas: string[];
  /** event timestamps, ascending, in ms */
  active: number[];
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

/** "42 min" or "3.5 h" for a sitting; a session resumed over days says how many days it was touched instead. */
function duration(active: number[]): string {
  if (active.length < 2) return '';
  const ms = active[active.length - 1] - active[0];
  if (ms < 3.6e6) return `${Math.round(ms / 6e4)} min`;
  if (ms < 24 * 3.6e6) return `${(ms / 3.6e6).toFixed(1)} h`;
  const days = new Set(active.map((t) => new Date(t).toISOString().slice(0, 10))).size;
  return `active on ${days} day${days === 1 ? '' : 's'}`;
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

/**
 * Text documents at the root of each folder and one level under its docs/, the documents a
 * backfill may cite. Record files are not documents: they are what is being written.
 */
function documents(dirs: { dir: string; show: (full: string) => string; isRecord?: boolean }[]): string[] {
  const out: string[] = [];
  for (const { dir, show, isRecord } of dirs) {
    for (const d of [dir, join(dir, 'docs')]) {
      for (const n of names(d)) {
        if (isRecord && RECORD_NAMES.includes(n.toLowerCase())) continue;
        const full = join(d, n);
        try {
          if (/\.(md|rst|txt)$/i.test(n) && statSync(full).isFile()) out.push(show(full));
        } catch {
          // vanished between listing and stat
        }
      }
    }
  }
  return out.slice(0, 60);
}

/** Folders or files whose name says they hold decisions, in the same folders documents are read from. */
function decisionSources(dirs: { dir: string; show: (full: string) => string }[]): string[] {
  const out: string[] = [];
  for (const { dir, show } of dirs) {
    for (const d of [dir, join(dir, 'docs')]) {
      for (const n of names(d)) if (/decision|\badr\b|adrs?$/i.test(n) && n.toLowerCase() !== 'decisions') out.push(show(join(d, n)));
    }
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

function sameSha(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** The largest active timestamp at or before t, by binary search over an ascending list. */
function lastActiveBefore(active: number[], t: number): number | undefined {
  let lo = 0, hi = active.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (active[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 ? active[best] : undefined;
}

/**
 * Which session a commit belongs to. A session whose transcript shows the commit being made owns
 * it outright. Otherwise it goes to the session with a line at most thirty minutes before the
 * commit, the nearest such line winning; a session's idle days claim nothing.
 */
function ownerOf(c: LogLine, windows: Window[]): Window | undefined {
  const exact = windows.find((w) => w.shas.some((s) => sameSha(s, c.sha)));
  if (exact) return exact;
  const t = Date.parse(c.date);
  let best: Window | undefined, gap = Infinity;
  for (const w of windows) {
    const last = lastActiveBefore(w.active, t);
    if (last === undefined) continue;
    const d = t - last;
    if (d <= AFTER_MS && d < gap) { best = w; gap = d; }
  }
  return best;
}

export async function buildDossier(p: ProjectDetail, sessions: Map<string, Session>, record?: ProjectRecord, claudeRoot?: string): Promise<string> {
  const out: string[] = [];
  const present = existsSync(p.root);
  // A deleted working copy still has its default-branch log in the archive.
  const archived = !present && claudeRoot ? archivedCommits(claudeRoot, p.root) : undefined;
  const branch = present ? defaultBranch(p.root) : archived?.branch ?? '';
  const commits: LogLine[] = present
    ? commitLog(p.root, branch)
    : (archived?.commits ?? []).map((c) => ({ sha: c.sha.slice(0, 7), date: c.ts, subject: c.subject, body: c.body })).reverse();
  const tagList = present ? tags(p.root) : [];
  const recordDir = p.recordRoot && !p.recordMissing ? p.recordRoot : undefined;
  const clash = recordDir ? clashes(recordDir) : [];
  // Documents live in the repository, or beside the record when the owner keeps notes elsewhere:
  // the record folder itself, or its parent when the record sits in an `agenttrace` subfolder.
  const docDirs: { dir: string; show: (full: string) => string; isRecord?: boolean }[] = [];
  if (present) docDirs.push({ dir: p.root, show: (full) => relative(p.root, full).replace(/\\/g, '/') });
  if (recordDir && !inside(p.root, recordDir)) {
    const sub = basename(recordDir).toLowerCase() === 'agenttrace';
    docDirs.push({ dir: sub ? dirname(recordDir) : recordDir, show: (full) => resolve(full).replace(/\\/g, '/'), isRecord: !sub });
  }
  const docs = documents(docDirs);
  const decisionDocs = decisionSources(docDirs);
  const statusLogs = docs.filter((d) => /progress|changelog|journal|status|history/i.test(basename(d)));
  const reasoned = commits.filter((c) => c.body.length > 0 || REASON.test(c.subject));
  const list = [...p.sessionList].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

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
    if (commits.length && list.length && day(commits[0].date) < day(list[0].startedAt)) out.push(`- The commits before ${day(list[0].startedAt)} have no archived session: the tool had removed those transcripts before they were indexed.`);
    out.push(`- Commits whose message states a reason: ${reasoned.length}${reasoned.length ? ' (listed at the end)' : ''}`);
  } else if (archived) {
    out.push(`- Working copy not on disk. Commits on ${branch} from the archived log: ${commits.length}${commits.length ? `, from ${day(commits[0].date)} to ${day(commits[commits.length - 1].date)}` : ''}, copied ${day(archived.archivedAt)}; tags and documents in the repository cannot be read.`);
    out.push(`- Commits whose message states a reason: ${reasoned.length}${reasoned.length ? ' (listed at the end)' : ''}`);
  } else out.push('- Working copy not on disk and no archived log: no commits, tags or documents can be read.');
  out.push(`- Documents already kept for the project: ${docs.length ? docs.join(', ') : 'none'}`);
  out.push(`- Decision records found: ${decisionDocs.length ? decisionDocs.join(', ') : 'none'}`);
  out.push(`- Dated status log found: ${statusLogs.length ? statusLogs.join(', ') : 'none'}`);
  out.push('', 'What that allows, per record document:', '');
  out.push(`- stack.md, architecture.md, learning/: ${present ? 'from the working copy.' : 'not writable, the working copy is gone.'}`);
  const sequence = commits.length > 1 || list.length > 0 || tagList.length > 0 || statusLogs.length > 0;
  out.push(`- roadmap.md: ${sequence ? `a sequence exists (${commits.length} dated commits, ${list.length} sessions, ${tagList.length} tags${statusLogs.length ? `, ${statusLogs.join(', ')}` : ''}).` : 'no sequence: one milestone "as found", and say the order of work is unknown.'}`);
  const decisionEvidence = reasoned.length > 0 || decisionDocs.length > 0 || list.length > 0;
  out.push(`- decisions/: ${decisionEvidence ? `sources exist (${reasoned.length} commits with a stated reason${decisionDocs.length ? `, ${decisionDocs.join(', ')}` : ''}${list.length ? `, ${list.length} sessions` : ''}); write only what they state.` : 'no stated reason anywhere: write none, list the unexplained choices in gaps.md.'}`);
  out.push(`- journal/: ${list.length ? `${list.length} sessions, one entry each${statusLogs.length ? `; earlier work may cite ${statusLogs.join(', ')}` : ''}.` : statusLogs.length ? `no sessions; entries may cite ${statusLogs.join(', ')}.` : 'no sessions and no dated log: write none.'}`);
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

  // One parse per session feeds the stack table, the commit join and the per-session digest.
  const seen = new Set<string>();
  const stack: { tech: string; ts: string; evidence: string; session: string }[] = [];
  const digests: { lines: string[]; window: Window }[] = [];
  const windows: Window[] = [];
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
    const active = parsed.events.map((e) => Date.parse(e.ts)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
    const start = row.startedAt || s.startedAt;
    const w: Window = { title: row.title, shas: commitsMade(parsed.events, s).map((c) => c.sha), active };
    windows.push(w);
    const when = duration(active);
    const lines = [
      `### ${day(start)} · ${row.title}`,
      '',
      `- Session \`${s.id}\`, ran in \`${s.cwd}\`${when ? `, ${when}` : ''}; ${row.calls} tool calls, ${row.failed} failed; ` +
        (row.byCwdOnly ? 'wrote nothing here' : `${row.edits} writes here${row.primary ? '' : ', mainly elsewhere'}`),
    ];
    if (files.length) {
      const shown = files.slice(0, 12).map((f) => `${relative(p.root, f.path).replace(/\\/g, '/')} (${f.versions.length} version${f.versions.length === 1 ? '' : 's'})`);
      lines.push(`- Files: ${shown.join(', ')}${files.length > 12 ? `, and ${files.length - 12} more` : ''}`);
    }
    if (helpers.size) lines.push(`- Helpers: ${[...helpers.entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')}`);
    digests.push({ lines, window: w });
  }
  const owners = new Map<LogLine, Window | undefined>(commits.map((c) => [c, ownerOf(c, windows)]));
  for (const d of digests) {
    const made = commits.filter((c) => owners.get(c) === d.window);
    if (made.length) d.lines.push(`- Commits: ${made.map((c) => `\`${c.sha}\` ${c.subject}`).join('; ')}`);
  }

  const covered = new Set<string>();
  for (const l of record?.learning ?? []) {
    covered.add(l.slug.toLowerCase());
    for (const t of l.tags) covered.add(t.toLowerCase());
  }
  const missing = (techs: string[]) => techs.filter((t) => !covered.has(t.toLowerCase()));

  out.push('## Stack seen in the sessions', '');
  if (!stack.length) out.push('Nothing detected: no dependency file, import or config file was written in an archived session.');
  else {
    out.push('| Technology | Category | First seen | Session | Evidence |', '|---|---|---|---|---|');
    for (const s of stack.sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
      const cat = (STACK as Record<string, { category?: string }>)[s.tech]?.category ?? '';
      out.push(`| ${s.tech} | ${cat} | ${day(s.ts)} | ${escapeCell(s.session)} | ${escapeCell(s.evidence).slice(0, 80)} |`);
    }
  }
  out.push('');

  // What the sessions no longer show, the files still do: the stack as it stands, for stack.md.
  if (present) {
    const tree = stackInTree(p.root).filter((t) => !seen.has(t.tech));
    out.push('## Stack in the working copy, not seen in any session', '');
    if (!tree.length) out.push('Nothing beyond the table above.');
    else {
      out.push('| Technology | Category | Evidence |', '|---|---|---|');
      for (const t of tree) {
        const cat = (STACK as Record<string, { category?: string }>)[t.tech]?.category ?? '';
        out.push(`| ${t.tech} | ${cat} | ${escapeCell(relative(p.root, t.evidence.replace(/^.* in /, '')).replace(/\\/g, '/'))}${t.evidence.includes(' in ') ? ` (${escapeCell(t.evidence.replace(/ in .*$/, ''))})` : ''} |`);
      }
    }
    if (record) {
      const gone = missing([...stack.map((s) => s.tech), ...tree.map((t) => t.tech)]);
      out.push('', gone.length ? `Lessons missing for: ${gone.join(', ')}.` : 'Every technology above has a lesson.');
    }
    out.push('');
  }

  out.push('## Sessions, oldest first', '');
  if (!digests.length) out.push('No archived session worked in this repository.');
  else out.push(digests.map((d) => d.lines.join('\n')).join('\n\n'));
  out.push('');

  if (present || commits.length) {
    const rows = commits.slice(-MAX_COMMITS);
    out.push(`## Commits on ${branch}, oldest first`, '');
    if (!rows.length) out.push('No commits.');
    else {
      if (commits.length > rows.length) out.push(`The last ${rows.length} of ${commits.length}.`, '');
      out.push('| Date | Commit | Subject | Session |', '|---|---|---|---|');
      for (const c of rows) out.push(`| ${day(c.date)} | \`${c.sha}\` | ${escapeCell(c.subject)} | ${escapeCell(owners.get(c)?.title ?? 'no session active')} |`);
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
