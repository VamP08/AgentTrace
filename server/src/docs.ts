// The record: the folder of Markdown files the agenttrace skill writes while a project is built.
// Found from a session's cwd through agenttrace.json. Frontmatter is parsed; bodies stay Markdown.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import matter from 'gray-matter';
import type { Decision, JournalEntry, LearningEntry, ProjectManifest, ProjectRecord, RecordDoc } from '@agenttrace/shared';

/** Walk up from cwd looking for agenttrace.json; the record path inside may be relative to it. */
export function findManifest(cwd: string): { manifest: ProjectManifest; root: string } | undefined {
  let dir = resolve(cwd);
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'agenttrace.json');
    if (existsSync(file)) {
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as ProjectManifest;
        if (typeof manifest.record !== 'string' || typeof manifest.project !== 'string') return undefined;
        const root = isAbsolute(manifest.record) ? manifest.record : resolve(dir, manifest.record);
        return { manifest, root };
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

function readDoc(root: string, name: string, unparsed: ProjectRecord['unparsed']): RecordDoc<any> | undefined {
  const file = join(root, name);
  if (!existsSync(file)) return undefined;
  try {
    const m = matter(readFileSync(file, 'utf8'));
    return { updated: str(m.data.updated, undefined as any), data: m.data, body: m.content.trim() };
  } catch (e) {
    unparsed.push({ file: name, error: (e as Error).message });
    return undefined;
  }
}

function readFolder<T>(root: string, folder: string, unparsed: ProjectRecord['unparsed'], map: (slug: string, data: Record<string, any>, body: string) => T): T[] {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    try {
      const m = matter(readFileSync(join(dir, name), 'utf8'));
      out.push(map(basename(name, '.md'), m.data, m.content.trim()));
    } catch (e) {
      unparsed.push({ file: `${folder}/${name}`, error: (e as Error).message });
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
  if (!found) return undefined;
  const { manifest, root } = found;
  const unparsed: ProjectRecord['unparsed'] = [];
  const learning = readFolder<LearningEntry>(root, 'learning', unparsed, (slug, d, body) => ({
    slug,
    title: str(d.title, slug),
    summary: str(d.summary),
    type: (d.type ?? 'term') as LearningEntry['type'],
    level: (d.level ?? 'beginner') as LearningEntry['level'],
    tags: list(d.tags),
    files: list(d.files),
    prerequisites: list(d.prerequisites),
    related: list(d.related),
    date: str(d.date),
    updated: str(d.updated, str(d.date)),
    body,
  })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const decisions = readFolder<Decision>(root, 'decisions', unparsed, (slug, d, body) => ({
    slug,
    title: str(d.title, slug),
    status: d.status === 'superseded' ? 'superseded' : 'accepted',
    date: str(d.date),
    tags: list(d.tags),
    files: list(d.files),
    supersedes: d.supersedes ? String(d.supersedes) : undefined,
    body,
  })).sort((a, b) => (a.date < b.date ? 1 : -1));
  const journal = readFolder<JournalEntry>(root, 'journal', unparsed, (slug, d, body) => ({
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
    body,
  })).sort((a, b) => (a.started < b.started ? 1 : -1));
  return {
    project: manifest.project,
    root,
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
