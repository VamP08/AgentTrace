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
  /** absolute path -> backup file name under file-history/<session>/ */
  files: Record<string, { backup: string; version: number; backupTime: string }>;
}

export interface AgentSpawnEvent extends EventBase {
  kind: 'agent_spawn';
  toolUseId: string;
  agentType: string;
  description: string;
  brief: string;
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
  | RawEvent;

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
