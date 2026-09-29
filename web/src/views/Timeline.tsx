// The session as turns. A turn is one of your prompts and everything the model did in answer.
// The turn happening now is the page; the others are chapters with counts, folded until opened.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AgentInfo, Event, ToolCallEvent, ToolResultEvent } from '@agenttrace/shared';
import { gloss } from '@agenttrace/shared';
import { ToolCard } from '../components/ToolCard';
import { plain, said } from '../prompt';

interface Turn {
  n: number;
  prompt: string;
  images: number;
  startTs: string;
  endTs: string;
  events: Event[];
  calls: number;
  failed: number;
  files: Set<string>;
  /** the last tool call, and whether it has a result yet */
  lastCall?: ToolCallEvent;
  lastCallDone: boolean;
  lastModelText?: string;
}

type Row =
  | { key: string; kind: 'chapter'; turn: Turn; open: boolean }
  | { key: string; kind: 'commit'; commit: Commit }
  | { key: string; kind: 'assistant' | 'context' | 'raw'; ev: Event }
  | { key: string; kind: 'tool'; ev: ToolCallEvent; result?: ToolResultEvent; agent?: AgentInfo; first: boolean };

export interface Commit { sha: string; ts: string; subject: string; repo?: string; merged?: boolean; files: { path: string; added: number; removed: number }[] }

interface Props {
  events: Event[];
  agents: AgentInfo[];
  loading: boolean;
  parseErrors: number;
  batches: number;
  live: boolean;
  /** toolUseId -> ms, from the hook log */
  durations?: Record<string, number>;
  commits?: Commit[];
  sessionId?: string;
}

const WAIT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function buildTurns(events: Event[]): Turn[] {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const turns: Turn[] = [];
  let cur: Turn | undefined;
  for (const e of events) {
    if (e.kind === 'user') {
      cur = { n: turns.length + 1, prompt: e.text, images: e.images, startTs: e.ts, endTs: e.ts, events: [], calls: 0, failed: 0, files: new Set(), lastCallDone: true };
      turns.push(cur);
      continue;
    }
    if (!cur) continue; // context that arrives before the first prompt belongs to no turn
    cur.events.push(e);
    if (e.ts) cur.endTs = e.ts;
    if (e.kind === 'tool_call') {
      cur.calls++;
      const r = results.get(e.toolUseId);
      if (r?.isError) cur.failed++;
      const input = (e.input ?? {}) as Record<string, unknown>;
      if ((e.name === 'Write' || e.name === 'Edit') && typeof input.file_path === 'string') cur.files.add(input.file_path);
      cur.lastCall = e;
      cur.lastCallDone = !!r;
    }
    if (e.kind === 'assistant_text') cur.lastModelText = e.text;
  }
  return turns;
}

export function turnState(t: Turn, live: boolean): string {
  if (t.lastCall && !t.lastCallDone) return WAIT_TOOLS.has(t.lastCall.name) ? 'Waiting for you' : live ? 'Working' : 'Cut off';
  return 'Answered';
}

export function Timeline({ events, agents, loading, parseErrors, batches, live, durations, commits = [], sessionId }: Props) {
  const [show, setShow] = useState<Record<string, boolean>>({ context: false, raw: false });
  const [follow, setFollow] = useState(true);
  const [openTurns, setOpenTurns] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  // where the reader was when they scrolled away, so "n new" counts only what arrived since
  const since = useRef(0);

  const turns = useMemo(() => buildTurns(events), [events]);
  const current = turns[turns.length - 1];
  const agentByTool = useMemo(() => new Map(agents.map((a) => [a.toolUseId, a])), [agents]);
  const results = useMemo(() => {
    const m = new Map<string, ToolResultEvent>();
    for (const e of events) if (e.kind === 'tool_result') m.set(e.toolUseId, e);
    return m;
  }, [events]);

  const isOpen = (t: Turn) => openTurns[t.n] ?? (live ? t === current : t.n === 1);
  const counts = useMemo(() => {
    let context = 0, raw = 0;
    for (const e of events) { if (e.kind === 'context') context++; else if (e.kind === 'raw') raw++; }
    return { context, raw };
  }, [events]);

  const rows = useMemo<Row[]>(() => {
    const seen = new Set<string>();
    // first-appearance is decided in session order, whichever way the chapters are listed
    const firstOf = new Map<string, string>();
    for (const e of events) if (e.kind === 'tool_call' && !seen.has(e.name)) { seen.add(e.name); firstOf.set(e.name, e.id); }
    const ordered = live ? [...turns].reverse() : turns;
    const out: Row[] = [];
    for (const t of ordered) {
      const open = isOpen(t);
      out.push({ key: `turn:${t.n}`, kind: 'chapter', turn: t, open });
      if (!open) continue;
      // commits made while this turn was running belong to it: after its first line and within
      // half an hour of its last, so days of idle time between turns never sweep in unrelated work
      const next = turns[t.n];
      const cutoff = new Date(new Date(t.endTs).getTime() + 30 * 60_000).toISOString();
      const mine = commits.filter((c) => c.ts >= t.startTs && c.ts <= cutoff && (!next || c.ts < next.startTs)).sort((a, b) => (a.ts < b.ts ? -1 : 1));
      let ci = 0;
      const flush = (upTo: string) => {
        while (ci < mine.length && (!upTo || mine[ci].ts <= upTo)) { out.push({ key: `commit:${mine[ci].sha}`, kind: 'commit', commit: mine[ci] }); ci++; }
      };
      for (const e of t.events) {
        flush(e.ts); // commits interleave with events by clock time
        switch (e.kind) {
          case 'assistant_text': out.push({ key: e.id, kind: 'assistant', ev: e }); break;
          case 'tool_call': out.push({ key: e.id, kind: 'tool', ev: e, result: results.get(e.toolUseId), agent: agentByTool.get(e.toolUseId), first: firstOf.get(e.name) === e.id }); break;
          case 'context': if (show.context) out.push({ key: e.id, kind: 'context', ev: e }); break;
          case 'raw': if (show.raw) out.push({ key: e.id, kind: 'raw', ev: e }); break;
          default: break;
        }
      }
      flush('');
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, turns, results, agentByTool, show, openTurns, live, commits]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 14,
    getItemKey: (i) => rows[i].key,
    useFlushSync: false,
  });

  // Live and following: keep the current chapter's newest line in view. Newest-first ordering
  // puts that near the top, so following means staying at the top of the list.
  useEffect(() => {
    if (!follow || !live || !rows.length) return;
    const id = requestAnimationFrame(() => virt.scrollToIndex(0, { align: 'start' }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, follow, live]);

  // Scrolling away from a live session stops the follow silently; this is what says so, and
  // it names what clicking it will do rather than leaving the reader to infer a toggle's state.
  const stopFollowing = () => {
    if (!follow) return;
    since.current = events.length;
    setFollow(false);
  };
  const fresh = useMemo(() => {
    if (follow) return 0;
    let n = 0;
    for (let i = since.current; i < events.length; i++) {
      const k = events[i].kind;
      if (k === 'user' || k === 'assistant_text' || k === 'tool_call') n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, follow]);

  const slot = document.getElementById('view-tools');

  return (
    <>
      {slot &&
        createPortal(
          <>
            <button className={`btn sm ${show.context ? 'on' : ''}`} onClick={() => setShow({ ...show, context: !show.context })} aria-pressed={show.context}>Context {counts.context}</button>
            <button className={`btn sm ${show.raw ? 'on' : ''}`} onClick={() => setShow({ ...show, raw: !show.raw })} aria-pressed={show.raw}>Raw records {counts.raw}</button>
            {parseErrors > 0 && <span className="pill fail">{parseErrors} unreadable lines</span>}
            {live && !follow && (
              <button className="jump" onClick={() => { setFollow(true); virt.scrollToIndex(0, { align: 'start' }); }}>
                Jump to now{fresh > 0 && <span className="k">· {fresh} new</span>}
              </button>
            )}
          </>,
          slot,
        )}
      <div className="scroll" ref={scrollRef} onWheel={stopFollowing} aria-busy={loading}>
        {loading && <div className="empty">Reading the transcript…</div>}
        {!loading && turns.length === 0 && (
          <div className="empty">
            <h3>No prompts yet.</h3>
            This transcript has no turn from you. Toggle Raw records above to see what the file holds.
          </div>
        )}
        {!loading && current && <Now turn={current} live={live} turns={turns} events={events} />}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => (
            <div key={v.key} data-index={v.index} ref={virt.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}>
              <RowView row={rows[v.index]} live={live} durations={durations} sessionId={sessionId} onToggle={(t) => setOpenTurns({ ...openTurns, [t.n]: !isOpen(t) })} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** What is true right now, or, for a finished session, what the whole session amounted to. */
function Now({ turn, live, turns, events }: { turn: Turn; live: boolean; turns: Turn[]; events: Event[] }) {
  const state = turnState(turn, live);
  if (!live) {
    const files = new Set<string>();
    let calls = 0, failed = 0;
    for (const t of turns) { calls += t.calls; failed += t.failed; for (const f of t.files) files.add(f); }
    const stack = events.filter((e) => e.kind === 'stack_detected').length;
    return (
      <section className="now idle" aria-label="Session summary">
        <div className="now-h">Session summary</div>
        <div className="now-grid">
          <Stat n={turns.length} label={one(turns.length, 'turn', 'turns')} />
          <Stat n={calls} label={one(calls, 'tool call', 'tool calls')} />
          <Stat n={files.size} label={one(files.size, 'file changed', 'files changed')} />
          <Stat n={failed} label="failed" tone={failed ? 'fail' : undefined} />
          <Stat n={stack} label={one(stack, 'technology', 'technologies')} />
          <Stat n={span(turns[0]?.startTs, turn.endTs)} label="elapsed" />
        </div>
        <p className="now-p">Open a turn below to read what the model did in answer to it. Files changed across the session are listed under Files.</p>
      </section>
    );
  }
  const call = turn.lastCall;
  const g = call ? gloss(call.name) : undefined;
  return (
    <section className="now" aria-label="Now">
      <div className="now-h">Now <span className={`pill ${state === 'Working' ? 'ok' : state === 'Answered' ? '' : 'live'}`}>{state}</span></div>
      <div className="now-ask">
        <span className="who">You asked</span>
        <Prompt text={turn.prompt} />
      </div>
      {turn.lastModelText && (
        <div className="now-say">
          <span className="who">Model said</span>
          <p>{plain(turn.lastModelText)}</p>
        </div>
      )}
      {call && (
        <div className="now-do">
          <span className="who">{turn.lastCallDone ? 'Last tool' : 'Running'}</span>
          <div>
            <span className="mono name">{call.name}</span> <span className="mono arg">{argOf(call)}</span>
            {g && <div className="explain-line">{g.what}</div>}
          </div>
        </div>
      )}
      <div className="now-grid">
        <Stat n={turn.calls} label={one(turn.calls, 'tool call this turn', 'tool calls this turn')} />
        <Stat n={turn.files.size} label={one(turn.files.size, 'file changed', 'files changed')} />
        <Stat n={turn.failed} label="failed" tone={turn.failed ? 'fail' : undefined} />
        <Stat n={span(turn.startTs, turn.endTs)} label="so far" />
      </div>
    </section>
  );
}

/** Four lines of the prompt, then the rest on request. A four-thousand-character paste would
 *  otherwise push the chapter list off the screen and the Now panel would stop being a panel. */
function Prompt({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p ref={ref} className={open ? '' : 'clamped'}>{text}</p>
      {(over || open) && (
        <button className="btn sm quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show four lines' : 'Show the whole prompt'}
        </button>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: 'fail' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function RowView({ row, live, durations, sessionId, onToggle }: { row: Row; live: boolean; durations?: Record<string, number>; sessionId?: string; onToggle: (t: Turn) => void }) {
  if (row.kind === 'commit') {
    const c = row.commit;
    const added = c.files.reduce((n, f) => n + f.added, 0);
    const removed = c.files.reduce((n, f) => n + f.removed, 0);
    return (
      <div className="row commit">
        <div className="time">{clock(c.ts)}</div>
        <div className="who">Commit</div>
        <div className="text">
          {c.repo && <span className="c repo">{c.repo} </span>}<span className="mono sha">{c.sha}</span> {c.subject}
          {c.merged === false && <span className="pill fail" title="On a branch that has not reached the default branch"> not merged</span>}
          <span className="c"> · {c.files.length} file{c.files.length === 1 ? '' : 's'} <b className="add">+{added}</b> <b className="del">−{removed}</b></span>
          {sessionId && <a className="c link" href={`/api/sessions/${sessionId}/commits?sha=${c.sha}`} target="_blank" rel="noreferrer">show diff</a>}
        </div>
      </div>
    );
  }
  if (row.kind === 'chapter') {
    const t = row.turn;
    const state = turnState(t, live);
    return (
      <button className={`chapter ${row.open ? 'open' : ''}`} onClick={() => onToggle(t)} aria-expanded={row.open}>
        <span className="chev" aria-hidden />
        <span className="n">{t.n}</span>
        <span className="p">{(said(t.prompt) ?? (/<task-notification>/i.test(t.prompt) ? 'System notification' : 'System message')).split('\n')[0]}{t.images > 0 ? ` [${t.images} image${t.images > 1 ? 's' : ''}]` : ''}</span>
        <span className="c">{t.calls} calls</span>
        <span className="c">{t.files.size} files</span>
        {t.failed > 0 && <span className="c fail">{t.failed} failed</span>}
        <span className="c">{span(t.startTs, t.endTs)}</span>
        <span className={`c state ${state === 'Working' ? 'ok' : state === 'Answered' ? '' : 'live'}`}>{state}</span>
        <span className="c time">{clock(t.startTs)}</span>
      </button>
    );
  }
  const time = clock(row.ev.ts);
  const ev = row.ev as any;
  switch (row.kind) {
    case 'assistant':
      return (
        <div className="row assistant">
          <div className="time">{time}</div>
          <div className="who">Model</div>
          <div className="text">{plain(ev.text)}</div>
        </div>
      );
    case 'tool':
      return (
        <div className="row tool">
          <div className="time">{time}</div>
          <div className="who">Tool</div>
          <ToolCard call={row.ev} result={row.result} agent={row.agent} first={row.first} durationMs={durations?.[row.ev.toolUseId]} />
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

const one = (n: number, single: string, many: string) => (n === 1 ? single : many);

function argOf(call: ToolCallEvent): string {
  const i = (call.input ?? {}) as Record<string, any>;
  const v = i.description || i.file_path || i.pattern || i.skill || i.url || i.query || i.command || '';
  return String(v).split(/[\\/]/).slice(-2).join('/').slice(0, 100);
}

function clock(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
}

function span(a?: string, b?: string): string {
  if (!a || !b) return '';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
