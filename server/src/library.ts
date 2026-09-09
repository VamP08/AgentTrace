// The shared library: one entry per concept, written once and read from every project. A project
// lesson names an entry in `extends` and overlays it, so the general explanation lives in one
// place and the project keeps only what is its own — where it used the thing, and why.
//
// This file also decides what "finished" means. An entry has thirteen slots; twelve are authored
// and one is computed. Completeness is a count over those, which is what lets the app show
// progress, estimate what finishing costs, and tell a slot nobody wrote from one that cannot be
// written here.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import type {
  Completeness, Encounter, EntrySource, LearningEntry, LibraryEntry, ProjectRecord,
  SlotId, SlotStatus,
} from '@agenttrace/shared';
import { COMPUTED_SLOTS, REQUIRED_SLOTS, SLOTS } from '@agenttrace/shared';

/**
 * Headings that fill a body slot. Matched case-insensitively on the whole heading, then by
 * prefix, so "Why here" from the older lessons and "Why you would reach for it" from the newer
 * ones both land on `why` without either being rewritten.
 */
const HEADING_SLOTS: [RegExp, SlotId][] = [
  [/^what it is\b/i, 'what-it-is'],
  [/^why\b/i, 'why'],
  [/^the idea in one picture\b/i, 'picture'],
  [/^how it works\b/i, 'how-it-works'],
  [/^cheat ?sheet\b/i, 'cheat-sheet'],
  [/^common mistakes\b/i, 'common-mistakes'],
  [/^where it shows up\b/i, 'where-it-shows-up'],
  [/^go deeper\b/i, 'go-deeper'],
];

export interface Section {
  title: string;
  body: string;
  slot?: SlotId;
}

/** Split a body on level-2 headings. Order is preserved; a body with no headings is one section. */
export function sections(body: string): Section[] {
  const parts = body.split(/^## +/m);
  if (parts.length < 2) return body.trim() ? [{ title: '', body: body.trim() }] : [];
  return parts.slice(1).map((p) => {
    const nl = p.indexOf('\n');
    const title = (nl < 0 ? p : p.slice(0, nl)).trim();
    const text = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    return { title, body: text, slot: HEADING_SLOTS.find(([re]) => re.test(title))?.[1] };
  });
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Which slots this entry holds, which are empty, and which it says cannot be filled here.
 * `where-it-shows-up` is computed from the projects that used the concept, so it is never
 * counted as missing — an entry nobody has anchored yet is not incomplete for that reason.
 */
export function completeness(entry: {
  body: string;
  objectives?: string[];
  questions?: unknown[];
  exercise?: unknown;
  sources?: unknown[];
  verified?: unknown;
  cannotFill?: Record<string, string>;
}): Completeness {
  const bySlot = new Map<SlotId, Section>();
  for (const s of sections(entry.body)) if (s.slot && !bySlot.has(s.slot)) bySlot.set(s.slot, s);

  const fromFrontmatter: Partial<Record<SlotId, number>> = {
    objectives: entry.objectives?.length ?? 0,
    questions: entry.questions?.length ?? 0,
    exercise: entry.exercise ? 1 : 0,
    sources: entry.sources?.length ?? 0,
    verified: entry.verified ? 1 : 0,
  };

  const cannot = entry.cannotFill ?? {};
  const slots: SlotStatus[] = SLOTS.map((slot) => {
    const reason = cannot[slot];
    const section = bySlot.get(slot);
    const count = fromFrontmatter[slot];
    const present = section ? true : count !== undefined ? count > 0 : false;
    if (present) return { slot, state: 'written', words: section ? words(section.body) : count };
    if (reason) return { slot, state: 'unfillable', reason };
    return { slot, state: 'empty' };
  });

  const authored = slots.filter((s) => !COMPUTED_SLOTS.includes(s.slot));
  const written = authored.filter((s) => s.state === 'written').length;
  const fillable = authored.filter((s) => s.state !== 'unfillable').length;
  const hasFloor = REQUIRED_SLOTS.every((r) => slots.find((s) => s.slot === r)?.state === 'written');
  return { slots, written, fillable, hasFloor, complete: written === fillable };
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
}
function str(v: unknown, fallback = ''): string {
  return v === undefined || v === null ? fallback : v instanceof Date ? v.toISOString() : String(v);
}

export function readSources(v: unknown): EntrySource[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && (typeof s === 'string' || s.url))
    .map((s) => (typeof s === 'string' ? { url: s } : { url: String(s.url), title: s.title ? String(s.title) : undefined, took: s.took ? String(s.took) : undefined, fetched: s.fetched ? str(s.fetched) : undefined }));
}

export function readVerified(v: unknown): LibraryEntry['verified'] {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  if (d.command === undefined) return undefined;
  return { command: String(d.command), exit: Number(d.exit ?? 0), version: d.version ? String(d.version) : undefined, at: d.at ? str(d.at) : undefined };
}

export function readCannotFill(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, reason] of Object.entries(v as Record<string, unknown>)) {
    if ((SLOTS as readonly string[]).includes(k) && reason) out[k] = String(reason);
  }
  return out;
}

function questions(v: unknown): LibraryEntry['questions'] {
  if (!Array.isArray(v)) return [];
  return v.filter((x: any) => x && x.q).map((x: any) => ({
    q: String(x.q),
    a: str(x.a),
    id: x.id ? String(x.id) : undefined,
    kind: ['recall', 'predict', 'apply', 'explain'].includes(x.kind) ? x.kind : undefined,
  }));
}

function exercise(v: unknown): LibraryEntry['exercise'] {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  if (!d.task) return undefined;
  return { task: String(d.task), hint: d.hint ? String(d.hint) : undefined, solution: d.solution ? String(d.solution) : undefined, id: d.id ? String(d.id) : undefined };
}

/** Every .md under the library root, keyed by its path below that root without the extension. */
export function readLibrary(root: string): { entries: LibraryEntry[]; unparsed: ProjectRecord['unparsed'] } {
  const entries: LibraryEntry[] = [];
  const unparsed: ProjectRecord['unparsed'] = [];
  if (!root || !existsSync(root)) return { entries, unparsed };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.md')) continue;
      const key = relative(root, full).split(sep).join('/').replace(/\.md$/, '');
      try {
        const m = matter(readFileSync(full, 'utf8'), {});
        const d = m.data ?? {};
        if (!d.title) {
          unparsed.push({ file: key, error: `${key}: frontmatter did not parse or has no "title"` });
          continue;
        }
        entries.push({
          key,
          slug: basename(name, '.md'),
          title: str(d.title, key),
          summary: str(d.summary),
          type: (d.type ?? 'term') as LibraryEntry['type'],
          level: (d.level ?? 'beginner') as LibraryEntry['level'],
          tags: list(d.tags),
          prerequisites: list(d.prerequisites),
          related: list(d.related),
          objectives: list(d.objectives),
          questions: questions(d.questions),
          exercise: exercise(d.exercise),
          sources: readSources(d.sources),
          verified: readVerified(d.verified),
          cannotFill: readCannotFill(d.cannot_fill ?? d.cannotFill),
          purl: d.purl ? String(d.purl) : undefined,
          date: str(d.date),
          updated: str(d.updated, str(d.date)),
          body: m.content.trim(),
        });
      } catch (e) {
        unparsed.push({ file: key, error: `${key}: frontmatter did not parse: ${(e as Error).message}` });
      }
    }
  };
  walk(root);
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return { entries, unparsed };
}

export interface ResolvedLesson {
  /** the lesson as the reader meets it: library sections, overridden by the project's own */
  sections: Section[];
  /** where each section came from, so the page can say which is shared and which is this project's */
  origin: Record<string, 'library' | 'project'>;
  entry?: LibraryEntry;
  completeness: Completeness;
  /** the overlay named a library entry that does not exist */
  missingExtends?: string;
}

/**
 * Merge a project lesson over the library entry it extends. Sections are keyed by exact heading
 * text: a heading the project also writes replaces the library's, everything else is appended in
 * library order first, then the project's own. Keying on the heading rather than on meaning is
 * what keeps the merge deterministic — the app has no model to decide what two sections have in
 * common.
 */
export function resolveLesson(lesson: LearningEntry, library: LibraryEntry[]): ResolvedLesson {
  const own = sections(lesson.body);
  if (!lesson.extends) {
    return { sections: own, origin: Object.fromEntries(own.map((s) => [s.title, 'project' as const])), completeness: completeness(lesson) };
  }
  const entry = library.find((e) => e.key === lesson.extends || e.slug === lesson.extends);
  if (!entry) {
    return {
      sections: own,
      origin: Object.fromEntries(own.map((s) => [s.title, 'project' as const])),
      completeness: completeness(lesson),
      missingExtends: lesson.extends,
    };
  }
  const base = sections(entry.body);
  const ownByTitle = new Map(own.map((s) => [s.title.toLowerCase(), s]));
  const origin: Record<string, 'library' | 'project'> = {};
  const merged: Section[] = [];
  for (const s of base) {
    const replacement = ownByTitle.get(s.title.toLowerCase());
    merged.push(replacement ?? s);
    origin[(replacement ?? s).title] = replacement ? 'project' : 'library';
  }
  for (const s of own) {
    if (base.some((b) => b.title.toLowerCase() === s.title.toLowerCase())) continue;
    merged.push(s);
    origin[s.title] = 'project';
  }
  // Completeness is the concept's, filled from either side: the project may supply a slot the
  // library entry lacks, and the reader has it either way.
  const combinedBody = merged.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n');
  const merge = completeness({
    body: combinedBody,
    objectives: lesson.objectives?.length ? lesson.objectives : entry.objectives,
    questions: lesson.questions?.length ? lesson.questions : entry.questions,
    exercise: lesson.exercise ?? entry.exercise,
    sources: lesson.sources?.length ? lesson.sources : entry.sources,
    verified: lesson.verified ?? entry.verified,
    cannotFill: { ...entry.cannotFill, ...lesson.cannotFill },
  });
  return { sections: merged, origin, entry, completeness: merge };
}

/** Every project lesson that extends a given library entry, for the computed "where it shows up". */
export function encountersOf(key: string, records: ProjectRecord[]): Encounter[] {
  const out: Encounter[] = [];
  for (const r of records) {
    for (const l of r.learning) {
      if (l.extends && (l.extends === key || key.endsWith(`/${l.extends}`))) {
        out.push({ project: r.project, lessonSlug: l.slug, title: l.title, files: l.files, anchor: l.anchor, session: l.session });
      }
    }
  }
  return out;
}
