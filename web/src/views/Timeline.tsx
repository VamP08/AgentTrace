import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AgentInfo, Event, ToolResultEvent } from '@agenttrace/shared';
import { ToolCard } from '../components/ToolCard';

type Row =
  | { key: string; kind: 'user' | 'assistant' | 'context' | 'raw'; ev: Event }
  | { key: string; kind: 'tool'; ev: Extract<Event, { kind: 'tool_call' }>; result?: ToolResultEvent; agent?: AgentInfo };

const FILTERS = [
  { id: 'context', label: 'context' },
  { id: 'raw', label: 'raw records' },
] as const;

interface Props {
  events: Event[];
  agents: AgentInfo[];
  loading: boolean;
  parseErrors: number;
  batches: number;
}

export function Timeline({ events, agents, loading, parseErrors, batches }: Props) {
  const [show, setShow] = useState<Record<string, boolean>>({ context: false, raw: false });
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const results = new Map<string, ToolResultEvent>();
    for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    const agentByTool = new Map(agents.map((a) => [a.toolUseId, a]));
    const out: Row[] = [];
    for (const e of events) {
      switch (e.kind) {
        case 'user': out.push({ key: e.id, kind: 'user', ev: e }); break;
        case 'assistant_text': out.push({ key: e.id, kind: 'assistant', ev: e }); break;
        case 'tool_call': out.push({ key: e.id, kind: 'tool', ev: e, result: results.get(e.toolUseId), agent: agentByTool.get(e.toolUseId) }); break;
        case 'context': if (show.context) out.push({ key: e.id, kind: 'context', ev: e }); break;
        case 'raw': if (show.raw) out.push({ key: e.id, kind: 'raw', ev: e }); break;
        default: break; // usage, snapshot, tool_result, agent_spawn are folded into other rows or headers
      }
    }
    return out;
  }, [events, agents, show]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
    getItemKey: (i) => rows[i].key,
    // Measured rows notify during React's commit; a synchronous flush there trips React 18.
    useFlushSync: false,
  });

  useEffect(() => {
    if (!follow || !rows.length) return;
    // Scroll on the next frame: calling into the virtualizer during React's commit makes it
    // flush synchronously and React warns about it.
    const id = requestAnimationFrame(() => virt.scrollToIndex(rows.length - 1, { align: 'end' }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, rows.length, follow]);

  const toolsSlot = document.getElementById('tab-tools');

  return (
    <>
      {toolsSlot &&
        createPortal(
          <>
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip ${show[f.id] ? 'on' : ''}`} onClick={() => setShow({ ...show, [f.id]: !show[f.id] })}>
                {f.label}
              </button>
            ))}
            {parseErrors > 0 && <span className="chip">{parseErrors} unreadable lines</span>}
            <button className={`chip follow ${follow ? 'on' : ''}`} onClick={() => setFollow(!follow)} aria-pressed={follow}>
              {follow ? 'following' : 'follow'}
            </button>
          </>,
          toolsSlot,
        )}
      <div className="scroll" ref={scrollRef} onWheel={() => follow && setFollow(false)}>
        {loading && <div className="empty">Reading the transcript…</div>}
        {!loading && rows.length === 0 && <div className="empty">Nothing to show yet.</div>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index];
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virt.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
              >
                <RowView row={r} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function RowView({ row }: { row: Row }) {
  const time = clock(row.ev.ts);
  switch (row.kind) {
    case 'user':
      return (
        <div className="row user">
          <div className="time">{time}</div>
          <div className="stamp">YOU</div>
          <div className="text">
            {(row.ev as any).text}
            {(row.ev as any).images > 0 && <span className="src"> [{(row.ev as any).images} image(s) not shown]</span>}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="row assistant">
          <div className="time">{time}</div>
          <div className="stamp">MODEL</div>
          <div className="text">{(row.ev as any).text}</div>
        </div>
      );
    case 'tool':
      return (
        <div className={`row tool ${row.result?.isError ? 'error' : ''}`}>
          <div className="time">{time}</div>
          <div className="stamp">TOOL</div>
          <ToolCard call={row.ev} result={row.result} agent={row.agent} />
        </div>
      );
    case 'context':
      return (
        <div className="row context">
          <div className="time">{time}</div>
          <div className="stamp">CTX</div>
          <div className="text">
            <span className="src">{(row.ev as any).source}</span>
            {String((row.ev as any).content).slice(0, 400)}
          </div>
        </div>
      );
    case 'raw':
      return (
        <div className="row context">
          <div className="time">{time}</div>
          <div className="stamp">RAW</div>
          <div className="text">
            <span className="src">{(row.ev as any).type}</span>
            {(row.ev as any).data ? JSON.stringify((row.ev as any).data).slice(0, 300) : ''}
            {(row.ev as any).error ?? ''}
          </div>
        </div>
      );
  }
}

function clock(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
}
