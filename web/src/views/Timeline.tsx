import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AgentInfo, Event, ToolResultEvent } from '@agenttrace/shared';
import { ToolCard } from '../components/ToolCard';

type Row =
  | { key: string; kind: 'user' | 'assistant' | 'context' | 'raw'; ev: Event }
  | { key: string; kind: 'tool'; ev: Extract<Event, { kind: 'tool_call' }>; result?: ToolResultEvent; agent?: AgentInfo; first: boolean };

interface Props {
  events: Event[];
  agents: AgentInfo[];
  loading: boolean;
  parseErrors: number;
  batches: number;
  live: boolean;
}

export function Timeline({ events, agents, loading, parseErrors, batches, live }: Props) {
  const [show, setShow] = useState<Record<string, boolean>>({ context: false, raw: false });
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const results = new Map<string, ToolResultEvent>();
    for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    const agentByTool = new Map(agents.map((a) => [a.toolUseId, a]));
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const e of events) {
      switch (e.kind) {
        case 'user': out.push({ key: e.id, kind: 'user', ev: e }); break;
        case 'assistant_text': out.push({ key: e.id, kind: 'assistant', ev: e }); break;
        case 'tool_call': {
          const first = !seen.has(e.name);
          seen.add(e.name);
          out.push({ key: e.id, kind: 'tool', ev: e, result: results.get(e.toolUseId), agent: agentByTool.get(e.toolUseId), first });
          break;
        }
        case 'context': if (show.context) out.push({ key: e.id, kind: 'context', ev: e }); break;
        case 'raw': if (show.raw) out.push({ key: e.id, kind: 'raw', ev: e }); break;
        default: break;
      }
    }
    return out;
  }, [events, agents, show]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 14,
    getItemKey: (i) => rows[i].key,
    useFlushSync: false,
  });

  useEffect(() => {
    if (!follow || !live || !rows.length) return;
    const id = requestAnimationFrame(() => virt.scrollToIndex(rows.length - 1, { align: 'end' }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, rows.length, follow, live]);

  const slot = document.getElementById('view-tools');

  return (
    <>
      {slot &&
        createPortal(
          <>
            <button className={`btn sm ${show.context ? 'on' : ''}`} onClick={() => setShow({ ...show, context: !show.context })} aria-pressed={show.context}>
              Context
            </button>
            <button className={`btn sm ${show.raw ? 'on' : ''}`} onClick={() => setShow({ ...show, raw: !show.raw })} aria-pressed={show.raw}>
              Raw records
            </button>
            {parseErrors > 0 && <span className="pill fail">{parseErrors} unreadable lines</span>}
            {live && (
              <button className={`btn sm ${follow ? 'on' : ''}`} onClick={() => setFollow(!follow)} aria-pressed={follow}>
                {follow ? 'Following' : 'Follow'}
              </button>
            )}
          </>,
          slot,
        )}
      <div className="scroll" ref={scrollRef} onWheel={() => follow && setFollow(false)}>
        {loading && <div className="empty">Reading the transcript…</div>}
        {!loading && rows.length === 0 && <div className="empty">Nothing to show yet.</div>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => (
            <div key={v.key} data-index={v.index} ref={virt.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}>
              <RowView row={rows[v.index]} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function RowView({ row }: { row: Row }) {
  const time = clock(row.ev.ts);
  const ev = row.ev as any;
  switch (row.kind) {
    case 'user':
      return (
        <div className="row user">
          <div className="time">{time}</div>
          <div className="who">You</div>
          <div className="text">
            {ev.text}
            {ev.images > 0 && <span className="src"> [{ev.images} image{ev.images > 1 ? 's' : ''} not shown]</span>}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="row assistant">
          <div className="time">{time}</div>
          <div className="who">Model</div>
          <div className="text">{ev.text}</div>
        </div>
      );
    case 'tool':
      return (
        <div className="row tool">
          <div className="time">{time}</div>
          <div className="who">Tool</div>
          <ToolCard call={row.ev} result={row.result} agent={row.agent} first={row.first} />
        </div>
      );
    case 'context':
      return (
        <div className="row context">
          <div className="time">{time}</div>
          <div className="who">Context</div>
          <div className="text"><span className="src">{ev.source}</span>{String(ev.content).slice(0, 400)}</div>
        </div>
      );
    case 'raw':
      return (
        <div className="row context">
          <div className="time">{time}</div>
          <div className="who">Record</div>
          <div className="text"><span className="src">{ev.type}</span>{ev.data ? JSON.stringify(ev.data).slice(0, 300) : ''}{ev.error ?? ''}</div>
        </div>
      );
  }
}

function clock(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
}
