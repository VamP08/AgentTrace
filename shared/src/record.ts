// The record is the folder of Markdown files the agenttrace skill writes while a project is
// built. These types mirror the frontmatter defined in skill/SKILL.md. Bodies stay as Markdown.

export type LearningType =
  | 'library'
  | 'tool'
  | 'pattern'
  | 'algorithm'
  | 'math'
  | 'architecture'
  | 'design'
  | 'security'
  | 'testing'
  | 'term';

export interface LearningEntry {
  slug: string;
  title: string;
  summary: string;
  type: LearningType;
  level: 'beginner' | 'intermediate' | 'advanced';
  tags: string[];
  files: string[];
  /** a symbol or phrase in the first file; the app shows the lines around it */
  anchor?: string;
  prerequisites: string[];
  related: string[];
  date: string;
  updated: string;
  session?: string;
  /** written after the fact from history rather than in the session that did the work */
  reconstructed?: boolean;
  /** what a reconstruction was written from: a path, a commit, a session id */
  source?: string;
  questions: { q: string; a: string; id?: string; kind?: QuestionKind }[];
  exercise?: { task: string; hint?: string; solution?: string; id?: string };
  /** the library entry this lesson overlays, e.g. "concept/rate-limiting"; absent means it stands alone */
  extends?: string;
  /** what the reader should be able to do afterwards */
  objectives: string[];
  /** where each claim came from, fetched when the entry was written */
  sources: EntrySource[];
  /** the example was run: what was run, what it returned, against which version, when */
  verified?: { command: string; exit: number; version?: string; at?: string };
  /** slots that cannot be filled here, and why — an empty slot is a to-do, this is a fact */
  cannotFill: Record<string, string>;
  /** the unit this entry belongs to on the project's path, e.g. "Systems" */
  unit?: string;
  body: string;
}

export type QuestionKind = 'recall' | 'predict' | 'apply' | 'explain';

export interface EntrySource {
  url: string;
  title?: string;
  /** what was taken from this source; a bare link list is not provenance */
  took?: string;
  fetched?: string;
}

/**
 * The thirteen slots an entry can hold, and no fourteenth. Five are required at first write,
 * seven accumulate, one is computed. Changing this list retrospectively changes every entry's
 * completeness, so it is changed deliberately — see the decision that defines it.
 */
export const SLOTS = [
  'what-it-is', 'why', 'picture', 'how-it-works', 'questions',
  'objectives', 'cheat-sheet', 'common-mistakes', 'exercise', 'verified', 'sources', 'go-deeper',
  'where-it-shows-up',
] as const;
export type SlotId = (typeof SLOTS)[number];

export const REQUIRED_SLOTS: SlotId[] = ['what-it-is', 'why', 'picture', 'how-it-works', 'questions'];
/** Assembled from the projects that used the concept; never written by hand, so never counted as missing. */
export const COMPUTED_SLOTS: SlotId[] = ['where-it-shows-up'];

export interface SlotStatus {
  slot: SlotId;
  state: 'written' | 'empty' | 'unfillable';
  /** words in the section, when it was written */
  words?: number;
  /** why it cannot be filled, when the entry says so */
  reason?: string;
}

export interface Completeness {
  slots: SlotStatus[];
  /** authored slots present */
  written: number;
  /** authored slots that could be filled here — the denominator */
  fillable: number;
  /** every required slot present */
  hasFloor: boolean;
  complete: boolean;
}

/** A window of a project file, for the "in this project" section of a lesson. */
export interface CodeWindow {
  path: string;
  /** 1-based line number of the first line returned */
  start: number;
  /** 1-based line the anchor was found on, if any */
  anchorLine?: number;
  lines: string[];
  totalLines: number;
  language: string;
}

export interface Decision {
  slug: string;
  title: string;
  status: 'accepted' | 'superseded';
  date: string;
  tags: string[];
  files: string[];
  supersedes?: string;
  /** the session that decided it; the join key from the record into the transcript */
  session?: string;
  reconstructed?: boolean;
  source?: string;
  body: string;
}

export interface JournalEntry {
  slug: string;
  date: string;
  started: string;
  ended?: string;
  milestone?: string;
  summary: string;
  learning: string[];
  decisions: string[];
  commits: string[];
  next: string[];
  /** the session this entry is the log of */
  session?: string;
  reconstructed?: boolean;
  source?: string;
  body: string;
}

export interface Milestone {
  id: string;
  title: string;
  status: 'planned' | 'in-progress' | 'done' | 'dropped';
  gate: string;
}

export interface StackItem {
  name: string;
  category: string;
  version?: string;
  why: string;
  instead_of?: string;
  learning?: string;
}

export interface Component {
  name: string;
  path: string;
  role: string;
  depends_on: string[];
}

export interface Gap {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'fixed';
  found: string;
  fixed?: string;
  files: string[];
}

/** One parsed single-file document: roadmap, stack, architecture, design, gaps. */
export interface RecordDoc<T> {
  updated?: string;
  data: T;
  body: string;
}

export interface ProjectRecord {
  project: string;
  /** absolute path of the record folder */
  root: string;
  /** absolute path of the folder holding agenttrace.json; `files` in entries are relative to it */
  repoDir: string;
  roadmap?: RecordDoc<{ milestones: Milestone[] }>;
  stack?: RecordDoc<{ stack: StackItem[] }>;
  architecture?: RecordDoc<{ components: Component[] }>;
  design?: RecordDoc<{ principles: string[]; tokens: Record<string, string> }>;
  gaps?: RecordDoc<{ gaps: Gap[] }>;
  learning: LearningEntry[];
  decisions: Decision[];
  journal: JournalEntry[];
  /** the shared library this project can draw on; empty when no library path is configured */
  library: LibraryEntry[];
  /** absolute path of the library root, when one is configured */
  libraryRoot?: string;
  /** files that exist but did not parse, with the reason */
  unparsed: { file: string; error: string }[];
}

/** agenttrace.json at the root of a project repo. */
export interface ProjectManifest {
  contract: 1;
  project: string;
  record: string;
  /** the shared library root, absolute or relative to this file; one entry per concept, reused across projects */
  library?: string;
}

/**
 * A concept written once and read from every project. A project lesson names one in `extends`
 * and overlays it; the same entry is the whole lesson when no project has anchored it yet.
 */
export interface LibraryEntry {
  /** namespaced key, e.g. "concept/rate-limiting" or "pkg/npm/chokidar/watching-a-folder" */
  key: string;
  slug: string;
  title: string;
  summary: string;
  type: LearningType;
  level: 'beginner' | 'intermediate' | 'advanced';
  tags: string[];
  prerequisites: string[];
  related: string[];
  objectives: string[];
  questions: { q: string; a: string; id?: string; kind?: QuestionKind }[];
  exercise?: { task: string; hint?: string; solution?: string; id?: string };
  sources: EntrySource[];
  verified?: { command: string; exit: number; version?: string; at?: string };
  cannotFill: Record<string, string>;
  /** the package this entry is about, when it is about one: pkg:npm/chokidar */
  purl?: string;
  date: string;
  updated: string;
  body: string;
}

/** One project's use of a library entry, joined for the "where it shows up" slot. */
export interface Encounter {
  project: string;
  lessonSlug: string;
  title: string;
  files: string[];
  anchor?: string;
  session?: string;
}
