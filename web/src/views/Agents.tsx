// Who was asked to do what. The main session spawns helpers; each helper has a brief (the
// exact instruction it received), its own transcript, and a report that came back to the parent.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgentInfo, Event, ToolCallEvent, ToolResultEvent } from '@agenttrace/shared';
import { Markdown } from '../components/Markdown';
import { Timeline } from './Timeline';

interface Props {
  sessionId: string;
  events: Event[];
  agents: AgentInfo[];
  agentEvents: Record<string, Event[]>;
  live: boolean;
  onLoadAgent: (agentId: string, events: Event[]) => void;
}

/** Ten lines of a brief or a report, as prose, then the rest on request. The fold is a whole
 *  number of lines, so it never lands through a row of glyphs. */
function Folded({ text, more }: { text: string; more: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <>
      <div className={`briefbody measure ${open ? 'all' : ''}`} ref={ref}>
        <Markdown text={text} />
      </div>
      {(over || open) && (
        <button className="btn sm quiet briefmore" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : more}
        </button>
      )}
    </>
  );
}

interface Node {
  info: AgentInfo;
  spawn?: ToolCallEvent;
  report?: ToolResultEvent;
  running: boolean;
  ts: string;
}

export function Agents({ sessionId, events, agents, agentEvents, live, onLoadAgent }: Props) {
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<string>();

  const nodes = useMemo<Node[]>(() => {
    const calls = new Map<string, ToolCallEvent>();
    const results = new Map<string, ToolResultEvent>();
    for (const e of events) {
      if (e.kind === 'tool_call') calls.set(e.toolUseId, e);
      if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    }
    return agents
      .map((info) => {
        const spawn = calls.get(info.toolUseId);
        const report = results.get(info.toolUseId);
        return { info, spawn, report, running: !!spawn && !report, ts: spawn?.ts ?? '' };
      })
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }, [events, agents]);

  const node = nodes.find((n) => n.info.agentId === picked);
  // The brief is the first thing the helper was told: the Agent call's prompt when the main
  // transcript has it, otherwise the first prompt in the helper's own transcript (workflows).
  const briefOf = (n: Node): string | undefined => {
    const fromCall = n.spawn ? String((n.spawn.input as any).prompt ?? '') : '';
    if (fromCall) return fromCall;
    const first = (agentEvents[n.info.agentId] ?? []).find((e) => e.kind === 'user');
    return first && first.kind === 'user' ? first.text : undefined;
  };
  const stateOf = (n: Node): string => {
    if (n.spawn) return n.running ? (live ? 'Working' : 'Cut off') : n.report?.isError ? 'Failed' : 'Reported';
    return 'Ran in a workflow';
  };

  useEffect(() => {
    if (!picked || agentEvents[picked]) return;
    setError(undefined);
    fetch(`/api/sessions/${sessionId}/events?agent=${picked}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => onLoadAgent(picked, d.events))
      .catch((e) =>
        setError(
          `Could not read this helper's transcript (${e.message}). The helper's own transcript file may have been cleaned up; the brief and the report above still come from the main session.`,
        ),
      );
  }, [picked, sessionId, agentEvents, onLoadAgent]);

  // Who asked whom. The list is in spawn order, so a helper's parent is the nearest row above it
  // one level shallower. Marking that chain draws the line from the picked helper back to the
  // main session, through everything it passes on the way.
  const chain = useMemo(() => {
    const rows = nodes.map(() => ({ thread: false, elbow: false, cx: 9, cx0: 9 }));
    const at = nodes.findIndex((n) => n.info.agentId === picked);
    if (at < 0) return { rows, drawn: false };
    const level = new Map<number, number>();
    let want = nodes[at].info.spawnDepth;
    level.set(at, want);
    for (let i = at - 1; i >= 0 && want > 1; i--) {
      if (nodes[i].info.spawnDepth === want - 1) { want--; level.set(i, want); }
    }
    let x = 9;
    for (let i = 0; i <= at; i++) {
      const d = level.get(i);
      const from = x;
      if (d !== undefined) x = 16 + d * 14 - 7;
      rows[i] = { thread: true, elbow: d !== undefined, cx: x, cx0: from };
    }
    return { rows, drawn: true };
  }, [nodes, picked]);

  return (
    <div className="split agents">
      <aside className="files">
        <h3>Helpers · {nodes.length}</h3>
        {nodes.length === 0 && (
          <div className="empty">This session did not hand work to any helper. When the model calls the Agent tool, the helper appears here with its brief.</div>
        )}
        <div className="tree">
          <div className={`node root ${chain.drawn ? 'thread' : ''}`} style={{ '--cx': '9px' } as CSSProperties}>
            <span className="p">Main session</span>
            <span className="c">{events.filter((e) => e.kind === 'tool_call').length} calls</span>
          </div>
          {nodes.map((n, i) => (
            <button
              key={n.info.agentId}
              className={`node ${picked === n.info.agentId ? 'sel' : ''} ${chain.rows[i].thread ? 'thread' : ''} ${chain.rows[i].elbow ? 'chain' : ''}`}
              style={{ paddingLeft: 16 + n.info.spawnDepth * 14, '--cx': `${chain.rows[i].cx}px`, '--cx0': `${chain.rows[i].cx0}px` } as CSSProperties}
              onClick={() => setPicked(n.info.agentId)}
              aria-current={picked === n.info.agentId ? 'true' : undefined}
            >
              <span className="p">{n.info.description || (n.spawn?.input as any)?.description || briefOf(n)?.split('\n')[0] || `helper ${n.info.agentId.slice(0, 6)}`}</span>
              <span className="c">{n.info.agentType}</span>
              <span className={`c state ${n.running && live ? 'ok' : ''}`}>{stateOf(n)}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="diffpane agentpane">
        {!node && (
          <div className="empty">
            <h3>Pick a helper.</h3>
            You will see the brief it was given, everything it did, and the report it sent back.
          </div>
        )}
        {node && (
          <>
            <div className="brief">
              <div className="brief-h">Brief <span className="c">{node.info.agentType} · {node.info.spawnDepth === 1 ? 'asked by the main session' : `depth ${node.info.spawnDepth}`}</span></div>
              <Folded text={briefOf(node) ?? 'Reading the brief…'} more="Show the whole brief" />
            </div>
            {error && <div className="notice fail">{error}</div>}
            {!error && (
              <div className="agent-stage">
                <Timeline events={agentEvents[node.info.agentId] ?? []} agents={[]} loading={!agentEvents[node.info.agentId]} parseErrors={0} batches={0} live={live && node.running} />
              </div>
            )}
            {node.report && (
              <div className={`brief report ${node.report.isError ? 'err' : ''}`}>
                <div className="brief-h">{node.report.isError ? 'Failed' : 'Report back to the main session'}</div>
                <Folded
                  text={node.report.content.slice(0, 6000) + (node.report.content.length > 6000 ? '\n…' : '')}
                  more="Show the whole report"
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
