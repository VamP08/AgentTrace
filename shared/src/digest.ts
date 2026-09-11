// The catch-up digest: one screen answering "what changed, and why" for a session nobody watched.
//
// Edits are listed raw and chronological, oldest first, one row per backed-up version. Folding
// them into one row per file is a toggle and never the default: the only measured evidence on
// this question (Parnin & DeLine, CHI 2010) found aggregated summaries lose to raw chronological
// hunks, because the aggregate hides the order the work actually happened in.

export interface DigestEdit {
  /** absolute path as the session wrote it */
  path: string;
  /** relative to the session's working directory when it is inside it, absolute otherwise */
  label: string;
  at: string;
  version: number;
  bytes: number;
  /** bytes since the previous version of this same file in this session; absent for the first */
  delta?: number;
}

export interface DigestFile {
  path: string;
  label: string;
  edits: number;
  first: string;
  last: string;
  bytes: number;
  /** bytes between the first and last version seen in this session */
  delta: number;
}

export interface DigestCommit {
  sha: string;
  subject: string;
  ts: string;
  repo?: string;
}

/** A record entry whose `session:` names this session: the reasoning written while the code was. */
export interface DigestNote {
  kind: 'lesson' | 'decision' | 'journal';
  project: string;
  id: string;
  title: string;
  summary: string;
}

export interface Digest {
  sessionId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  live: boolean;
  cwd: string;
  /** what the reader asked for, in their own words, oldest first */
  asked: string[];
  edits: DigestEdit[];
  files: DigestFile[];
  commits: DigestCommit[];
  helpers: { agentType: string; description: string }[];
  wrote: DigestNote[];
  /** what is not here and why, so a thin digest is not mistaken for a quiet session */
  missing: string[];
  counts: { turns: number; calls: number; failed: number; files: number; edits: number };
}
