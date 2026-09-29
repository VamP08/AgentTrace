// Search over the record: one flat list of things a question can land on, and the links that
// carry a reader from the thing they found to the rest of the story. The record is Markdown on
// disk; this is a view of it, never a second copy of the truth.

export type HitKind = 'lesson' | 'library' | 'decision' | 'journal' | 'stack' | 'gap' | 'milestone';

/** Where a hit goes next. `file` and `commit` and `session` are joins out of the record into the code. */
export type LinkKind = HitKind | 'file' | 'commit' | 'session';

export interface Link {
  kind: LinkKind;
  /** slug, library key, file path, commit sha or session id — whatever identifies the target */
  id: string;
  /** the record the target belongs to; absent for the shared library and for files and commits */
  project?: string;
  label: string;
}

export interface Hit {
  kind: HitKind;
  /** the record this came from; empty string for the shared library, which belongs to no project */
  project: string;
  id: string;
  title: string;
  summary: string;
  date?: string;
  score: number;
  /** which fields the query landed in, strongest first: title, tags, body… */
  matched: string[];
  /** one line of the body around the first match, for the result list */
  snippet: string;
  links: Link[];
}

export interface SearchResult {
  q: string;
  hits: Hit[];
  /** hits before the limit was applied */
  total: number;
  tookMs: number;
  /** what was searched, so an empty result can be told from an empty index */
  /** `roots` maps each record's project name to its folder, so the page can open a hit in the right project */
  indexed: { docs: number; projects: string[]; roots: Record<string, string> };
}
