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
  Completeness, Encounter, EntrySource, LearningEntry, LibraryEntry, ProjectRecord, Section, SlotId,
} from '@agenttrace/shared';
import { COMPUTED_SLOTS, REQUIRED_SLOTS, SLOTS, completeness, sections, words } from '@agenttrace/shared';

export { completeness, sections } from '@agenttrace/shared';

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
}
/**
 * A frontmatter value as text. YAML reads a bare `date: 2026-09-28` as a timestamp at midnight UTC,
 * which then printed as `2026-09-28T00:00:00.000Z` on every journal entry; a date-only value stays a
 * date. A real timestamp keeps its time.
 */
export function str(v: unknown, fallback = ''): string {
  if (v === undefined || v === null) return fallback;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  return String(v);
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
// gray-matter caches the file object under the raw text before it parses the frontmatter, and only
// when no options are passed. A YAML error therefore leaves a half-built entry (empty data, body
// still holding the frontmatter) in that cache, and every later read of the same text gets it back
// without throwing. So an (empty) options object is always passed and each read parses for real.

/**
 * A record file's frontmatter and body, parsed again only when its size or mtime moves. Opening
 * Learn read and parsed every lesson, decision, journal entry and library entry on every request:
 * 1.4 to 3.3 seconds for HRMS's record each time the tab was opened. A failure is kept too, so a
 * broken file is not re-parsed on every request either.
 */
const parsed = new Map<string, { stamp: string; data?: Record<string, any>; content?: string; error?: string }>();
export function readFrontmatter(file: string): { data: Record<string, any>; content: string } {
  const s = statSync(file);
  const stamp = `${s.size}:${s.mtimeMs}`;
  let hit = parsed.get(file);
  if (!hit || hit.stamp !== stamp) {
    try {
      const m = matter(readFileSync(file, 'utf8'), {});
      hit = { stamp, data: m.data ?? {}, content: m.content };
    } catch (e) {
      hit = { stamp, error: (e as Error).message };
    }
    parsed.set(file, hit);
  }
  if (hit.error !== undefined) throw new Error(hit.error);
  return { data: hit.data!, content: hit.content! };
}

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
        const m = readFrontmatter(full);
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
  // Key on the slot where a section has one, on the heading text where it does not. Keying on
  // text alone lets two wordings of the same slot both survive — the library's "Why you would
  // reach for it" and a lesson's "Why here" are the same section, and the reader must not get
  // both. Keying on the slot is also what makes the merge deterministic without a model.
  const keyOf = (s: Section) => s.slot ?? `title:${s.title.toLowerCase()}`;
  const ownByKey = new Map(own.map((s) => [keyOf(s), s]));
  const origin: Record<string, 'library' | 'project'> = {};
  const merged: Section[] = [];
  for (const s of base) {
    const replacement = ownByKey.get(keyOf(s));
    merged.push(replacement ?? s);
    origin[(replacement ?? s).title] = replacement ? 'project' : 'library';
  }
  const baseKeys = new Set(base.map(keyOf));
  for (const s of own) {
    if (baseKeys.has(keyOf(s))) continue;
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

/**
 * What a slot costs to write, in words. Measured from the entries that already have it, so the
 * estimate calibrates itself as the library grows. The fallbacks are the measured word counts of
 * the first entry written to the full shape (concept/rate-limiting, 2026-09-09) — a real
 * observation of one entry, not a guess, and labelled as a single sample so nobody reads more
 * into it than that.
 */
const FALLBACK_WORDS: Record<SlotId, number> = {
  'what-it-is': 161, why: 167, picture: 65, 'how-it-works': 326, questions: 278,
  objectives: 46, 'cheat-sheet': 253, 'common-mistakes': 164, exercise: 185,
  verified: 15, sources: 60, 'go-deeper': 201, 'where-it-shows-up': 0,
};

/** Slots whose writing means reading something outside the repository first. */
const NEEDS_FETCH: SlotId[] = ['sources', 'go-deeper'];

export interface SlotBasis {
  slot: SlotId;
  medianWords: number;
  samples: number;
  from: 'measured' | 'single observation';
}

export interface EntryEstimate {
  key: string;
  title: string;
  missing: SlotId[];
  unfillable: SlotId[];
  written: number;
  fillable: number;
  words: number;
  tokens: number;
}

/** A technology the project uses that has no entry at all: something to write, not something to finish. */
export interface CreateEstimate {
  name: string;
  category: string;
  why?: string;
  /** where an entry for it would go; a suggestion, since only the session writing it can be sure */
  suggestedKey: string;
  slots: SlotId[];
  words: number;
  tokens: number;
}

/** A concept this project uses that no lesson here anchors: the overlay is missing, not the entry. */
export interface AnchorEstimate {
  key: string;
  title: string;
  /** the stack row that points at it */
  name: string;
  words: number;
  tokens: number;
}

export interface Coverage {
  /** technologies named in stack.md */
  total: number;
  covered: number;
  uncovered: CreateEstimate[];
  /** entries the project uses but has not anchored in its own code */
  unanchored: AnchorEstimate[];
  /** which slots a first write actually contains here, and how that was worked out */
  firstWriteSlots: SlotId[];
  firstWriteBasis: string;
}

/**
 * Which slots a first write actually contains, measured rather than assumed.
 *
 * The first version of this costed a new entry at the five required slots. Twenty-four entries
 * were then written by a real session and every one arrived with eight — the floor plus sources,
 * a run example and go-deeper — so the estimate came in at 2.12x under. A slot counts as part of
 * a first write when more than half the entries written so far carry it: that way the number
 * follows what sessions do instead of what the contract asks for, and it moves on its own as
 * habits change.
 */
export function firstWriteSlots(entries: { body: string; objectives?: string[]; questions?: unknown[]; exercise?: unknown; sources?: unknown[]; verified?: unknown }[]): { slots: SlotId[]; basis: string } {
  if (entries.length === 0) {
    return { slots: [...REQUIRED_SLOTS], basis: 'no entries written yet, so a first write is costed at the five required slots' };
  }
  const seen = new Map<SlotId, number>();
  for (const e of entries) {
    for (const s of completeness(e).slots) {
      if (s.state === 'written' && !COMPUTED_SLOTS.includes(s.slot)) seen.set(s.slot, (seen.get(s.slot) ?? 0) + 1);
    }
  }
  const half = entries.length / 2;
  const slots = SLOTS.filter((s) => !COMPUTED_SLOTS.includes(s) && (seen.get(s) ?? 0) > half);
  // Never cost below the floor: a session may have written a run of thin entries, and the
  // contract still asks for five.
  for (const r of REQUIRED_SLOTS) if (!slots.includes(r)) slots.push(r);
  return {
    slots,
    basis: `${slots.length} slots, being those present in more than half of the ${entries.length} entries written so far`,
  };
}

export interface CompletionBrief {
  basis: SlotBasis[];
  entries: EntryEstimate[];
  /** technologies with no entry at all; empty when the project has no stack.md */
  coverage?: Coverage;
  totalWords: number;
  totalTokens: number;
  /** how the number was reached, for the screen; an estimate that hides its arithmetic is a guess in a costume */
  method: string[];
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** `Spring Boot` -> `spring-boot`, for a suggested slug. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Which technologies in `stack.md` have an entry, and which have nothing at all.
 *
 * This is the half the brief was blind to. Completeness measures entries that exist; a project
 * whose stack lists twenty-eight technologies and holds four lessons is not nearly finished, it
 * is barely started, and a brief that only counts slots in existing entries reports the opposite.
 * A technology counts as covered when the stack row names a lesson that exists, when its package
 * matches an entry's, or when its name matches an entry's slug — nothing looser, because a false
 * match hides exactly the gap this exists to show.
 */
export function stackCoverage(record: ProjectRecord, basis: SlotBasis[]): Coverage | undefined {
  const rows = record.stack?.data?.stack;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;

  const lessonSlugs = new Set(record.learning.map((l) => l.slug));
  const lessonNames = new Set(record.learning.map((l) => normalise(l.slug)));
  const libSlugs = new Set(record.library.map((e) => normalise(e.slug)));
  const libKeys = new Set(record.library.map((e) => e.key));
  const libPurls = new Set(record.library.map((e) => e.purl).filter(Boolean) as string[]);

  const wordsFor = new Map(basis.map((b) => [b.slot, b.medianWords]));
  const TOKENS_PER_WORD = 1.35;
  const FETCH_TOKENS = 4000;
  const first = firstWriteSlots(record.library);
  const firstWords = first.slots.reduce((n, s) => n + (wordsFor.get(s) ?? 0), 0);
  // An overlay is two sections: why this project reached for it, and where to look in this code.
  const anchorWords = (wordsFor.get('why') ?? 0) + 90;

  const extended = new Set(
    record.learning.flatMap((l) => (l.extends ? [l.extends, l.extends.split('/').pop() as string] : [])),
  );
  const unanchored: AnchorEstimate[] = [];
  const uncovered: CreateEstimate[] = [];
  let covered = 0;
  for (const row of rows) {
    const name = String((row as any)?.name ?? '').trim();
    if (!name) continue;
    const learning = (row as any)?.learning ? String((row as any).learning) : undefined;
    const purl = (row as any)?.purl ? String((row as any).purl) : undefined;
    const n = normalise(name);
    const hit =
      (learning && (lessonSlugs.has(learning) || libKeys.has(learning) || libSlugs.has(normalise(learning)))) ||
      (purl && libPurls.has(purl)) ||
      lessonNames.has(n) ||
      libSlugs.has(n);
    if (hit) {
      covered += 1;
      // Covered by an entry is not the same as anchored in this project's code. An entry nobody
      // here extends explains the technology in general and says nothing about where this
      // repository used it, which is the half a reader of their own codebase actually wants.
      const entry = record.library.find((e) => normalise(e.slug) === n || (purl && e.purl === purl) || (learning && (e.key === learning || normalise(e.slug) === normalise(learning))));
      if (entry && !extended.has(entry.key) && !extended.has(entry.slug)) {
        unanchored.push({
          key: entry.key,
          title: entry.title,
          name,
          words: anchorWords,
          tokens: Math.round(anchorWords * TOKENS_PER_WORD),
        });
      }
      continue;
    }
    uncovered.push({
      name,
      category: String((row as any)?.category ?? 'other'),
      why: (row as any)?.why ? String((row as any).why) : undefined,
      suggestedKey: purl ? `pkg/${purl.replace(/^pkg:/, '')}/${slugify(name)}` : `concept/${slugify(name)}`,
      slots: [...first.slots],
      words: firstWords,
      // A new entry is read from nothing, so there is no re-read cost; sources are always fetched.
      tokens: Math.round(firstWords * TOKENS_PER_WORD) + FETCH_TOKENS,
    });
  }
  return { total: rows.length, covered, uncovered, unanchored, firstWriteSlots: first.slots, firstWriteBasis: first.basis };
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Words per slot, measured across everything already written that has that slot. */
export function slotBasis(entries: { body: string; objectives?: string[]; questions?: { q: string; a: string }[]; exercise?: { task: string; hint?: string; solution?: string }; sources?: unknown[]; verified?: unknown }[]): SlotBasis[] {
  const samples = new Map<SlotId, number[]>();
  const add = (slot: SlotId, n: number) => {
    if (n > 0) samples.set(slot, [...(samples.get(slot) ?? []), n]);
  };
  for (const e of entries) {
    for (const s of sections(e.body)) if (s.slot) add(s.slot, words(s.body));
    add('objectives', words((e.objectives ?? []).join(' ')));
    add('questions', words((e.questions ?? []).map((q) => `${q.q} ${q.a}`).join(' ')));
    if (e.exercise) add('exercise', words([e.exercise.task, e.exercise.hint ?? '', e.exercise.solution ?? ''].join(' ')));
  }
  return SLOTS.map((slot) => {
    const got = samples.get(slot) ?? [];
    return got.length
      ? { slot, medianWords: median(got), samples: got.length, from: 'measured' as const }
      : { slot, medianWords: FALLBACK_WORDS[slot], samples: 1, from: 'single observation' as const };
  });
}

/**
 * What it would cost to finish these entries. Output tokens come from the words a slot has
 * historically taken; input tokens from re-reading the entry, plus an allowance for the pages a
 * session must open when a slot requires sources. Every number is arithmetic over measured
 * counts, and `method` carries the arithmetic so the screen can show it.
 */
export function completionBrief(
  entries: { key: string; title: string; body: string; objectives?: string[]; questions?: { q: string; a: string }[]; exercise?: unknown; sources?: unknown[]; verified?: unknown; cannotFill?: Record<string, string> }[],
  basis = slotBasis(entries as any),
  coverage?: Coverage,
): CompletionBrief {
  const wordsFor = new Map(basis.map((b) => [b.slot, b.medianWords]));
  const TOKENS_PER_WORD = 1.35;
  const FETCH_TOKENS = 4000;

  const out: EntryEstimate[] = [];
  for (const e of entries) {
    const c = completeness(e as any);
    const missing = c.slots.filter((s) => s.state === 'empty' && !COMPUTED_SLOTS.includes(s.slot)).map((s) => s.slot);
    const unfillable = c.slots.filter((s) => s.state === 'unfillable').map((s) => s.slot);
    if (!missing.length) continue;
    const w = missing.reduce((n, slot) => n + (wordsFor.get(slot) ?? 0), 0);
    const readTokens = Math.round(words(e.body) * TOKENS_PER_WORD);
    const fetchTokens = missing.some((m) => NEEDS_FETCH.includes(m)) ? FETCH_TOKENS : 0;
    out.push({
      key: e.key,
      title: e.title,
      missing,
      unfillable,
      written: c.written,
      fillable: c.fillable,
      words: w,
      tokens: Math.round(w * TOKENS_PER_WORD) + readTokens + fetchTokens,
    });
  }
  out.sort((a, b) => b.missing.length - a.missing.length || a.key.localeCompare(b.key));
  const measured = basis.filter((b) => b.from === 'measured').length;
  const createWords = (coverage?.uncovered ?? []).reduce((n, c) => n + c.words, 0)
    + (coverage?.unanchored ?? []).reduce((n, c) => n + c.words, 0);
  const createTokens = (coverage?.uncovered ?? []).reduce((n, c) => n + c.tokens, 0)
    + (coverage?.unanchored ?? []).reduce((n, c) => n + c.tokens, 0);
  return {
    basis,
    entries: out,
    coverage,
    totalWords: out.reduce((n, e) => n + e.words, 0) + createWords,
    totalTokens: out.reduce((n, e) => n + e.tokens, 0) + createTokens,
    method: [
      `Words per slot are the median of the entries that already have that slot; ${measured} of ${SLOTS.length} slots have at least one sample, the rest fall back to the measured counts of the first full entry.`,
      `Output tokens are words x ${TOKENS_PER_WORD}.`,
      `Input tokens are the entry re-read at the same rate, plus ${n(FETCH_TOKENS)} where a missing slot needs sources fetched.`,
      coverage
        ? `A technology with no entry is costed at ${coverage.firstWriteBasis}. An earlier version costed one at the five required slots and came in 2.12 times under, because real first writes arrive richer than the floor.`
        : 'A technology with no entry is costed at what a first write actually contains, measured from the entries already written.',
      'An entry the project uses but has not anchored is costed at two sections, why this project reached for it and where to look in this code, with no fetches, because the shared entry already carries the sources.',
      'The figure excludes the session\'s own reasoning and any code it runs to verify an example, so treat it as a floor rather than a forecast.',
    ],
  };
}

const SLOT_WORK: Partial<Record<SlotId, string>> = {
  'what-it-is': 'Two or three short paragraphs a non-programmer can follow: what the thing is, what it replaces, and the sentence that makes it click.',
  why: 'Why this project needed it, what simpler thing would have failed, and what it costs.',
  picture: 'One mermaid diagram of the mechanism, with a sentence under it saying what to look at.',
  'how-it-works': 'Numbered steps in the order the code does them, then one worked example with real numbers taken from this project.',
  questions: 'Two to four questions with answers, each answerable from the entry, at least one of them not pure recall. Give each an immutable id.',
  objectives: 'Three or four lines: what the reader should be able to do afterwards.',
  'cheat-sheet': 'A table of the surface actually used here — the decisions or calls, what each answers, and what getting it wrong looks like.',
  'common-mistakes': 'The mistakes this thing invites, each with the symptom that gives it away.',
  exercise: 'One task doable in ten minutes on this machine, with a hint and a real runnable solution. Give it an immutable id.',
  verified: 'Run the example. Record the command, exit code, resolved version and time in `verified:`. If it cannot be run here, write the reason under `cannot_fill:` instead.',
  sources: 'Search the web, open what you find, and record each source with the URL and what was taken from it. Do not write this from memory.',
  'go-deeper': 'Two or three links you actually opened, each with one line on why it is worth the reader\'s time.',
};

/** Group digits the same way on every machine; the default locale here groups Indian-style. */
function n(x: number): string {
  return x.toLocaleString('en-US');
}

/** The work order a session runs to finish these entries. The app writes the brief; the session writes the entries. */
export function briefMarkdown(project: string, brief: CompletionBrief, libraryRoot?: string): string {
  const L: string[] = [];
  L.push(`# Completion brief: ${project}`, '');
  const cov = brief.coverage;
  if (!brief.entries.length && !cov?.uncovered.length) {
    L.push('Every technology has an entry, and every entry is complete or says why a slot cannot be filled here.', '');
    return L.join('\n');
  }
  if (cov) {
    L.push(`**Coverage: ${cov.covered} of ${cov.total} technologies have an entry.** ${cov.uncovered.length} have none.`, '');
  }
  L.push(`${brief.entries.length} existing ${brief.entries.length === 1 ? 'entry is' : 'entries are'} short of a slot. Estimated **${n(brief.totalTokens)} tokens** for everything below, ${n(brief.totalWords)} words of writing.`, '');
  L.push('## How that number was reached', '');
  for (const m of brief.method) L.push(`- ${m}`);
  L.push('');
  L.push('## Rules', '');
  L.push('- Write each entry in the same turn you finish reading it; do not batch to the end.');
  L.push('- Search the web before writing. Anything you cannot open, do not claim.');
  L.push('- Run any example you write and record the result in `verified:`.');
  L.push('- A slot that cannot be filled here goes under `cannot_fill:` with the reason, not left blank.');
  if (libraryRoot) L.push(`- Shared entries live in \`${libraryRoot}\`; a project lesson overlays one by naming it in \`extends:\`.`);
  L.push('');
  if (cov && cov.uncovered.length) {
    L.push('## Technologies with no entry at all', '');
    L.push('These are named in `stack.md` and nothing explains them. Write each to the floor — what it is, why it is here, one diagram, how it works, two questions — and let the rest accumulate.', '');
    for (const c of cov.uncovered) {
      L.push(`- **${c.name}** (${c.category}) — suggest \`${c.suggestedKey}\`, about ${n(c.tokens)} tokens`);
      if (c.why) L.push(`  - the stack says: ${c.why}`);
    }
    L.push('');
  }
  if (cov && cov.unanchored.length) {
    L.push('## Entries this project uses but has not anchored', '');
    L.push(
      'The shared entry explains the technology; nothing here says where **this** repository used it. '
      + 'Write a short lesson in the record that names the entry in `extends:`, with `files:` and an `anchor:` '
      + 'pointing at the real code, a `## Why here` saying why this project reached for it, and a '
      + '`## Where to look` saying what to notice. Everything else is inherited, so these are two sections, not twelve.',
      '',
    );
    for (const a of cov.unanchored) {
      L.push(`- **${a.title}** — used for ${a.name}, extend \`${a.key}\`, about ${n(a.tokens)} tokens`);
    }
    L.push('');
  }
  L.push('## Entries, most incomplete first', '');
  for (const e of brief.entries) {
    L.push(`### ${e.title}`, '');
    L.push(`\`${e.key}\` — ${e.written}/${e.fillable} slots, about ${n(e.tokens)} tokens`, '');
    for (const slot of e.missing) L.push(`- **${slot}** — ${SLOT_WORK[slot] ?? 'write this slot'}`);
    if (e.unfillable.length) L.push('', `Already marked as unfillable here, leave alone: ${e.unfillable.join(', ')}.`);
    L.push('');
  }
  return L.join('\n');
}

/**
 * What the brief should measure: library entries as they are, and project lessons **after** the
 * overlay is resolved. Measuring an overlay on its own reports it as missing every slot the
 * library already supplies, which would ask a session to rewrite what it can already read — and
 * an overlay is thin by design, so it would never stop being reported.
 */
export function briefEntries(record: ProjectRecord): { key: string; title: string; body: string; objectives?: string[]; questions?: { q: string; a: string }[]; exercise?: unknown; sources?: unknown[]; verified?: unknown; cannotFill?: Record<string, string> }[] {
  const out = record.library.map((e) => ({ ...e }));
  for (const l of record.learning) {
    if (!l.extends) {
      out.push({ ...l, key: `learning/${l.slug}` } as any);
      continue;
    }
    const r = resolveLesson(l, record.library);
    if (!r.entry) {
      // The overlay names an entry that is not there; measure it alone and let the brief say so.
      out.push({ ...l, key: `learning/${l.slug}` } as any);
      continue;
    }
    out.push({
      ...l,
      key: `learning/${l.slug}`,
      body: r.sections.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n'),
      objectives: l.objectives?.length ? l.objectives : r.entry.objectives,
      questions: l.questions?.length ? l.questions : r.entry.questions,
      exercise: l.exercise ?? r.entry.exercise,
      sources: l.sources?.length ? l.sources : r.entry.sources,
      verified: l.verified ?? r.entry.verified,
      cannotFill: { ...r.entry.cannotFill, ...l.cannotFill },
    } as any);
  }
  return out;
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
