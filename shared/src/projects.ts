// A project is one git repository. Sessions are events; turns are the atom that attaches to a
// project, because one sitting often works on two repositories and neither should lose the work.

export interface TurnRef {
  sessionId: string;
  /** 1-based turn number inside its session */
  n: number;
  /** the first line of the prompt that opened the turn */
  prompt: string;
  startTs: string;
  endTs: string;
  calls: number;
  failed: number;
  /** edits per repository root, this turn only */
  edits: Record<string, number>;
  /** repository roots this turn also touched, besides the one whose list it appears in */
  also: string[];
}

/**
 * repo: a git repository, the real unit of work.
 * folder: a plain folder that was edited, no repository above it.
 * scratch: a per-session scratchpad or temp folder.
 * config: the coding tool's own folders, such as plans and memory.
 */
export type ProjectKind = 'repo' | 'folder' | 'scratch' | 'config';

export interface Project {
  /** absolute path of the repository root, or of the folder when it is not a repository */
  root: string;
  name: string;
  kind: ProjectKind;
  /** first remote URL, when the repository has one */
  remote?: string;
  turns: number;
  calls: number;
  failed: number;
  sessions: string[];
  firstTs: string;
  lastTs: string;
  /** true while any of its sessions is live */
  live: boolean;
  /** record folder from agenttrace.json at the root, when present */
  recordRoot?: string;
}

export interface ProjectDetail extends Project {
  turnList: TurnRef[];
  /** sessions that contributed, newest first, with how many turns each gave */
  sessionList: { id: string; title: string; turns: number; updatedAt: string; live: boolean }[];
}
