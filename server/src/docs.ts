// The record: the folder of Markdown files the agenttrace skill writes while a project is built.
// Found from a session's cwd through agenttrace.json. Frontmatter is parsed; bodies stay Markdown.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import matter from 'gray-matter';
import type { CodeWindow, Decision, JournalEntry, LearningEntry, ProjectManifest, ProjectRecord, RecordDoc } from '@agenttrace/shared';

/** Walk up from cwd looking for agenttrace.json; the record path inside may be relative to it. */
export function findManifest(cwd: string): { manifest: ProjectManifest; root: string; repoDir: string } | undefined {
  let dir = resolve(cwd);
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'agenttrace.json');
    if (existsSync(file)) {
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as ProjectManifest;
        if (typeof manifest.record !== 'string' || typeof manifest.project !== 'string') return undefined;
        const root = isAbsolute(manifest.record) ? manifest.record : resolve(dir, manifest.record);
        return { manifest, root, repoDir: dir };
      } catch {
        return undefined;
      }
    }
    const up = resolve(dir, '..');
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
}
function str(v: unknown, fallback = ''): string {
  return v === undefined || v === null ? fallback : v instanceof Date ? v.toISOString() : String(v);
}

// gray-matter caches the file object under the raw text before it parses the frontmatter, and only
// when no options are passed. A YAML error therefore leaves a half-built entry — empty data, body
// still holding the frontmatter — in that cache, and every later read of the same text gets it back
// without throwing. Pass an (empty) options object so each read parses for real.
function frontmatter(text: string) {
  return matter(text, {});
}

function readDoc(root: string, name: string, unparsed: ProjectRecord['unparsed']): RecordDoc<any> | undefined {
  const file = join(root, name);
  if (!existsSync(file)) return undefined;
  try {
    const m = frontmatter(readFileSync(file, 'utf8'));
    return { updated: str(m.data.updated, undefined as any), data: m.data, body: m.content.trim() };
  } catch (e) {
    unparsed.push({ file: name, error: (e as Error).message });
    return undefined;
  }
}

/** `required` is the frontmatter field an entry is useless without: without it the file is reported, not returned half-empty. */
function readFolder<T>(root: string, folder: string, required: string, unparsed: ProjectRecord['unparsed'], map: (slug: string, data: Record<string, any>, body: string) => T): T[] {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const rel = `${folder}/${name}`;
    try {
      const m = frontmatter(readFileSync(join(dir, name), 'utf8'));
      const value = m.data?.[required];
      if (value === undefined || value === null || value === '') {
        unparsed.push({ file: rel, error: `${rel}: frontmatter did not parse or has no "${required}"` });
        continue;
      }
      out.push(map(basename(name, '.md'), m.data, m.content.trim()));
    } catch (e) {
      unparsed.push({ file: rel, error: `${rel}: frontmatter did not parse: ${(e as Error).message}` });
    }
  }
  return out;
}

/** Try the session's cwd first, then the folders of files it touched: a session often runs one level above the project it edits. */
export function findManifestFor(cwd: string, touched: string[] = []): ReturnType<typeof findManifest> {
  const direct = findManifest(cwd);
  if (direct) return direct;
  const counts = new Map<string, number>();
  for (const p of touched) {
    const dir = resolve(p, '..');
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  for (const [dir] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const found = findManifest(dir);
    if (found) return found;
  }
  return undefined;
}

export function readRecord(cwd: string, touched: string[] = []): ProjectRecord | undefined {
  const found = findManifestFor(cwd, touched);
  return found && readRecordAt(found);
}

/** Read a record whose location is already known: from a manifest, or from the registry once the repository folder is gone. */
export function readRecordAt({ manifest, root, repoDir }: { manifest: ProjectManifest; root: string; repoDir: string }): ProjectRecord | undefined {
  const unparsed: ProjectRecord['unparsed'] = [];
  const learning = readFolder<LearningEntry>(root, 'learning', 'title', unparsed, (slug, d, body) => ({
    slug,
    title: str(d.title, slug),
    summary: str(d.summary),
    type: (d.type ?? 'term') as LearningEntry['type'],
    level: (d.level ?? 'beginner') as LearningEntry['level'],
    tags: list(d.tags),
    files: list(d.files),
    anchor: d.anchor ? String(d.anchor) : undefined,
    prerequisites: list(d.prerequisites),
    related: list(d.related),
    date: str(d.date),
    updated: str(d.updated, str(d.date)),
    session: d.session ? String(d.session) : undefined,
    reconstructed: d.reconstructed === true ? true : undefined,
    source: d.source ? String(d.source) : undefined,
    questions: Array.isArray(d.questions) ? d.questions.filter((x: any) => x && x.q).map((x: any) => ({ q: String(x.q), a: str(x.a) })) : [],
    exercise: d.exercise && typeof d.exercise === 'object' && d.exercise.task ? { task: String(d.exercise.task), hint: d.exercise.hint ? String(d.exercise.hint) : undefined, solution: d.exercise.solution ? String(d.exercise.solution) : undefined } : undefined,
    body,
  })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const decisions = readFolder<Decision>(root, 'decisions', 'title', unparsed, (slug, d, body) => ({
    slug,
    title: str(d.title, slug),
    status: d.status === 'superseded' ? 'superseded' : 'accepted',
    date: str(d.date),
    tags: list(d.tags),
    files: list(d.files),
    supersedes: d.supersedes ? String(d.supersedes) : undefined,
    reconstructed: d.reconstructed === true ? true : undefined,
    source: d.source ? String(d.source) : undefined,
    body,
  })).sort((a, b) => (a.date < b.date ? 1 : -1));
  const journal = readFolder<JournalEntry>(root, 'journal', 'date', unparsed, (slug, d, body) => ({
    slug,
    date: str(d.date),
    started: str(d.started),
    ended: d.ended ? str(d.ended) : undefined,
    milestone: d.milestone ? String(d.milestone) : undefined,
    summary: str(d.summary),
    learning: list(d.learning),
    decisions: list(d.decisions),
    commits: list(d.commits),
    next: list(d.next),
    reconstructed: d.reconstructed === true ? true : undefined,
    source: d.source ? String(d.source) : undefined,
    body,
  })).sort((a, b) => (a.started < b.started ? 1 : -1));
  return {
    project: manifest.project,
    root,
    repoDir,
    roadmap: readDoc(root, 'roadmap.md', unparsed),
    stack: readDoc(root, 'stack.md', unparsed),
    architecture: readDoc(root, 'architecture.md', unparsed),
    design: readDoc(root, 'design.md', unparsed),
    gaps: readDoc(root, 'gaps.md', unparsed),
    learning,
    decisions,
    journal,
    unparsed,
  };
}

const LANG: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', jsx: 'javascript', py: 'python', json: 'json', css: 'css', html: 'xml', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash', toml: 'ini' };

/** Lines around an anchor in a project file. The path must stay inside the repo folder. */
export function codeWindow(repoDir: string, relPath: string, anchor?: string, span = 40): CodeWindow | undefined {
  const full = resolve(repoDir, relPath);
  const base = resolve(repoDir);
  if (!full.startsWith(base + sep) && full !== base) return undefined;
  if (!existsSync(full)) return undefined;
  const all = readFileSync(full, 'utf8').split(/\r?\n/);
  let anchorLine: number | undefined;
  if (anchor) {
    const i = all.findIndex((l) => l.includes(anchor));
    if (i >= 0) anchorLine = i + 1;
  }
  const start = anchorLine ? Math.max(1, anchorLine - 6) : 1;
  const lines = all.slice(start - 1, start - 1 + span);
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  return { path: relPath, start, anchorLine, lines, totalLines: all.length, language: LANG[ext] ?? 'plaintext' };
}
