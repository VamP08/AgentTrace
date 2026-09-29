// Events are what the parser produces from one transcript line. Every view in the browser is
// built from this list plus the record documents in record.ts. Nothing else crosses the wire.

export interface EventBase {
  /** uuid of the transcript record, or a derived id for synthetic events */
  id: string;
  /** ISO timestamp from the record */
  ts: string;
  sessionId: string;
  /** undefined for the main conversation, agent id for a subagent transcript */
  agentId?: string;
  parentUuid?: string;
}

export interface UserEvent extends EventBase {
  kind: 'user';
  text: string;
  /** number of images stripped from the message */
  images: number;
}

export interface AssistantTextEvent extends EventBase {
  kind: 'assistant_text';
  text: string;
}

export interface ToolCallEvent extends EventBase {
  kind: 'tool_call';
  toolUseId: string;
  name: string;
  input: unknown;
  /** the working directory when the call was made; relative file paths in the input resolve against it */
  cwd?: string;
}

export interface ToolResultEvent extends EventBase {
  kind: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

/** Anything that entered the model's context without the user typing it: hooks, skills, reminders. */
export interface ContextEvent extends EventBase {
  kind: 'context';
  source: string;
  content: string;
}

export interface UsageEvent extends EventBase {
  kind: 'usage';
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface SnapshotEvent extends EventBase {
  kind: 'snapshot';
  /** path as the tool wrote it (often relative to cwd) -> backup under file-history/<session>/; dir is the real parent folder */
  files: Record<string, { backup: string; version: number; backupTime: string; dir?: string }>;
}

export interface AgentSpawnEvent extends EventBase {
  kind: 'agent_spawn';
  toolUseId: string;
  agentType: string;
  description: string;
  brief: string;
}

/** Derived, not read: a technology first seen in this session, with the line that gave it away. */
export interface StackDetectedEvent extends EventBase {
  kind: 'stack_detected';
  tech: string;
  evidence: string;
  file?: string;
}

/** Any record the parser does not turn into a richer event. Never dropped, so nothing is hidden. */
export interface RawEvent extends EventBase {
  kind: 'raw';
  type: string;
  /** small whitelisted payload: aiTitle, lastPrompt, mode, subtype */
  data?: Record<string, unknown>;
  error?: string;
}

export type Event =
  | UserEvent
  | AssistantTextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ContextEvent
  | UsageEvent
  | SnapshotEvent
  | AgentSpawnEvent
  | StackDetectedEvent
  | RawEvent;

export interface FileVersion {
  /** backup file name under file-history/<session>/ */
  backup: string;
  version: number;
  backupTime: string;
}

export interface TrackedFile {
  path: string;
  versions: FileVersion[];
}

export interface Session {
  id: string;
  /** directory name under projects/, e.g. e--Work-Live-code-Project */
  projectSlug: string;
  cwd: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  bytes: number;
  live: boolean;
  /** true when the coding tool's copy is gone and this is AgentTrace's own copy */
  archived: boolean;
  /**
   * true when a program started the session through the Agent SDK rather than a person through the
   * CLI or an editor — the transcript's `entrypoint` begins with `sdk`. On one machine 2,720 of 2,800
   * sessions were a memory plugin's headless workers; they are kept, but set apart from the person's own.
   */
  automated?: boolean;
  /** absolute path of the transcript */
  file: string;
  /** absolute path of the session folder: subagents, spilled tool results */
  dir: string;
  /** absolute path of the folder holding this session's file backups */
  fileHistory: string;
}

export interface AgentInfo {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string;
  spawnDepth: number;
  /** path of the agent transcript relative to the session directory */
  file: string;
}

/** Messages on the WebSocket, server to client. */
export type ServerMessage =
  | { type: 'history'; sessionId: string; agentId?: string; events: Event[]; parseErrors: number }
  | { type: 'events'; sessionId: string; agentId?: string; events: Event[] }
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'agents'; sessionId: string; agents: AgentInfo[] }
  | { type: 'record'; project: string; changed: string };

/** Messages on the WebSocket, client to server. */
export type ClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' };
