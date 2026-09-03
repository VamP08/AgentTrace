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
  prerequisites: string[];
  related: string[];
  date: string;
  updated: string;
  body: string;
}

export interface Decision {
  slug: string;
  title: string;
  status: 'accepted' | 'superseded';
  date: string;
  tags: string[];
  files: string[];
  supersedes?: string;
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
  roadmap?: RecordDoc<{ milestones: Milestone[] }>;
  stack?: RecordDoc<{ stack: StackItem[] }>;
  architecture?: RecordDoc<{ components: Component[] }>;
  design?: RecordDoc<{ principles: string[]; tokens: Record<string, string> }>;
  gaps?: RecordDoc<{ gaps: Gap[] }>;
  learning: LearningEntry[];
  decisions: Decision[];
  journal: JournalEntry[];
  /** files that exist but did not parse, with the reason */
  unparsed: { file: string; error: string }[];
}

/** agenttrace.json at the root of a project repo. */
export interface ProjectManifest {
  contract: 1;
  project: string;
  record: string;
}
