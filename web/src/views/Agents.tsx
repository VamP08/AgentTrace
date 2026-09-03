// Who was asked to do what. The main session spawns helpers; each helper has a brief (the
// exact instruction it received), its own transcript, and a report that came back to the parent.
import { useEffect, useMemo, useState } from 'react';
import type { AgentInfo, Event, ToolCallEvent, ToolResultEvent } from '@agenttrace/shared';
import { Timeline } from './Timeline';

interface Props {
  sessionId: string;
  events: Event[];
  agents: AgentInfo[];
  agentEvents: Record<string, Event[]>;
  live: boolean;
  onLoadAgent: (agentId: string, events: Event[]) => void;
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
      .catch((e) => setError(`Could not read this helper's transcript (${e.message}).`));
  }, [picked, sessionId, agentEvents, onLoadAgent]);

  return (
    <div className="split agents">
      <aside className="files">
        <h3>Helpers · {nodes.length}</h3>
        {nodes.length === 0 && (
          <div className="empty small">This session did not hand work to any helper. When the model calls the Agent tool, the helper appears here with its brief.</div>
        )}
        <div className="tree">
          <div className="node root">
            <span className="p">Main session</span>
            <span className="c">{events.filter((e) => e.kind === 'tool_call').length} calls</span>
          </div>
          {nodes.map((n) => (
            <button key={n.info.agentId} className={`node ${picked === n.info.agentId ? 'sel' : ''}`} style={{ paddingLeft: 16 + n.info.spawnDepth * 14 }} onClick={() => setPicked(n.info.agentId)} aria-current={picked === n.info.agentId ? 'true' : undefined}>
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
              <pre>{briefOf(node) ?? 'Reading the brief…'}</pre>
            </div>
            {error && <div className="notice">{error}</div>}
            {!error && (
              <div className="agent-stage">
                <Timeline events={agentEvents[node.info.agentId] ?? []} agents={[]} loading={!agentEvents[node.info.agentId]} parseErrors={0} batches={0} live={live && node.running} />
              </div>
            )}
            {node.report && (
              <div className={`brief report ${node.report.isError ? 'err' : ''}`}>
                <div className="brief-h">{node.report.isError ? 'Failed' : 'Report back to the main session'}</div>
                <pre>{node.report.content.slice(0, 6000)}{node.report.content.length > 6000 ? '\n…' : ''}</pre>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
