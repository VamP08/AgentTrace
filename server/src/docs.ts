// The record: the folder of Markdown files the agenttrace skill writes while a project is built.
// Found from a session's cwd through agenttrace.json. Frontmatter is parsed; bodies stay Markdown.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import type { CodeWindow, Decision, JournalEntry, LearningEntry, LibraryEntry, ProjectManifest, ProjectRecord, RecordDoc } from '@agenttrace/shared';
import { readCannotFill, readFrontmatter, readLibrary, readSources, readVerified, str } from './library.js';

/** Walk up from cwd looking for agenttrace.json; the record path inside may be relative to it. */
export function findManifest(cwd: string): { manifest: ProjectManifest; root: string; repoDir: string; library?: string } | undefined {
  let dir = resolve(cwd);
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'agenttrace.json');
    if (existsSync(file)) {
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as ProjectManifest;
        if (typeof manifest.record !== 'string' || typeof manifest.project !== 'string') return undefined;
        const root = isAbsolute(manifest.record) ? manifest.record : resolve(dir, manifest.record);
        const library = typeof manifest.library === 'string' && manifest.library
          ? (isAbsolute(manifest.library) ? manifest.library : resolve(dir, manifest.library))
          : undefined;
        return { manifest, root, repoDir: dir, library };
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

function readDoc(root: string, name: string, unparsed: ProjectRecord['unparsed']): RecordDoc<any> | undefined {
  const file = join(root, name);
  if (!existsSync(file)) return undefined;
  try {
    const m = readFrontmatter(file);
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
      const m = readFrontmatter(join(dir, name));
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
export function readRecordAt({ manifest, root, repoDir, library }: { manifest: ProjectManifest; root: string; repoDir: string; library?: string }): ProjectRecord | undefined {
  const unparsed: ProjectRecord['unparsed'] = [];
  const lib = library ? readLibrary(library) : { entries: [] as LibraryEntry[], unparsed: [] as ProjectRecord['unparsed'] };
  for (const u of lib.unparsed) unparsed.push({ file: `library/${u.file}`, error: u.error });
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
    questions: Array.isArray(d.questions) ? d.questions.filter((x: any) => x && x.q).map((x: any) => ({ q: String(x.q), a: str(x.a), id: x.id ? String(x.id) : undefined, kind: ['recall', 'predict', 'apply', 'explain'].includes(x.kind) ? x.kind : undefined })) : [],
    exercise: d.exercise && typeof d.exercise === 'object' && d.exercise.task ? { task: String(d.exercise.task), hint: d.exercise.hint ? String(d.exercise.hint) : undefined, solution: d.exercise.solution ? String(d.exercise.solution) : undefined, id: d.exercise.id ? String(d.exercise.id) : undefined } : undefined,
    extends: d.extends ? String(d.extends) : undefined,
    objectives: list(d.objectives),
    sources: readSources(d.sources),
    verified: readVerified(d.verified),
    cannotFill: readCannotFill(d.cannot_fill ?? d.cannotFill),
    unit: d.unit ? String(d.unit) : undefined,
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
    session: d.session ? String(d.session) : undefined,
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
    session: d.session ? String(d.session) : undefined,
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
    library: lib.entries,
    libraryRoot: library,
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
