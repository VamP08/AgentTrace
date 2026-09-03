// A project is one GitHub repository. Sessions attach to repositories: a session belongs to every
// repository it edited files in, or, when it edited nothing, to the repository it ran inside.
// A session that touched no repository is miscellaneous and lives outside the main list.

export interface SessionLink {
  sessionId: string;
  /** files written or edited inside this repository during the session */
  edits: number;
  /** true when this repository received the most edits of any the session touched */
  primary: boolean;
  /** true when the session ran inside this repository but edited nothing there */
  byCwdOnly: boolean;
}

/**
 * github: has a github.com remote, the real unit of work.
 * local: a git repository with no GitHub remote, not published yet.
 */
export type ProjectKind = 'github' | 'local';

export interface Project {
  /** stable id: "github.com/owner/repo" for GitHub, the canonical root path otherwise */
  id: string;
  kind: ProjectKind;
  /** owner/repo for GitHub, the folder name otherwise */
  name: string;
  /** absolute path of the working copy */
  root: string;
  remote?: string;
  sessions: SessionLink[];
  /** files written or edited across all sessions */
  edits: number;
  calls: number;
  failed: number;
  firstTs: string;
  lastTs: string;
  live: boolean;
  /** record folder from agenttrace.json at the root, when present */
  recordRoot?: string;
}

/** A session that touched no repository, listed under the folder it ran in. */
export interface MiscSession {
  sessionId: string;
  folder: string;
}

export interface ProjectIndex {
  projects: Project[];
  misc: MiscSession[];
}

export interface ProjectDetail extends Project {
  sessionList: { id: string; title: string; edits: number; primary: boolean; byCwdOnly: boolean; calls: number; failed: number; startedAt: string; updatedAt: string; live: boolean }[];
  /** other repositories its sessions also worked in, with how many of its sessions did */
  neighbours: { id: string; name: string; sessions: number }[];
}
