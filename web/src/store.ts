// One reducer holds everything the screen shows. Events are kept in arrival order and deduped
// by id, which is what lets a usage record for the same message overwrite an earlier one.
import type { AgentInfo, Event, ServerMessage, Session } from '@agenttrace/shared';

export interface State {
  sessions: Session[];
  selected?: string;
  events: Event[];
  index: Map<string, number>;
  agents: AgentInfo[];
  parseErrors: number;
  connected: boolean;
  loading: boolean;
  batches: number;
}

export const initial: State = {
  sessions: [],
  events: [],
  index: new Map(),
  agents: [],
  parseErrors: 0,
  connected: false,
  loading: false,
  batches: 0,
};

export type Action =
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'select'; id: string }
  | { type: 'socket'; open: boolean }
  | { type: 'server'; msg: ServerMessage };

function merge(events: Event[], index: Map<string, number>, incoming: Event[]): [Event[], Map<string, number>] {
  const next = events.slice();
  const idx = new Map(index);
  for (const e of incoming) {
    const at = idx.get(e.id);
    if (at === undefined) {
      idx.set(e.id, next.length);
      next.push(e);
    } else {
      next[at] = e;
    }
  }
  return [next, idx];
}

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'sessions':
      return { ...s, sessions: a.sessions };
    case 'select':
      if (a.id === s.selected) return s;
      return { ...s, selected: a.id, events: [], index: new Map(), agents: [], parseErrors: 0, loading: true };
    case 'socket':
      return { ...s, connected: a.open };
    case 'server': {
      const m = a.msg;
      if (m.type === 'sessions') return { ...s, sessions: m.sessions };
      if ('sessionId' in m && m.sessionId !== s.selected) return s;
      if (m.type === 'history') {
        const [events, index] = merge([], new Map(), m.events);
        return { ...s, events, index, parseErrors: m.parseErrors, loading: false };
      }
      if (m.type === 'events') {
        const [events, index] = merge(s.events, s.index, m.events);
        return { ...s, events, index, batches: s.batches + 1 };
      }
      if (m.type === 'agents') return { ...s, agents: m.agents };
      return s;
    }
  }
}
