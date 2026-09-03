import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fetchSessions, openSocket } from './api';
import { initial, reduce } from './store';
import { Timeline } from './views/Timeline';

const TABS = ['Timeline', 'Diffs', 'Agents', 'Context', 'Learn'] as const;

export function App() {
  const [s, dispatch] = useReducer(reduce, initial);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Timeline');
  const socket = useRef<ReturnType<typeof openSocket>>();
  const [tapeKey, setTapeKey] = useState(0);

  useEffect(() => {
    fetchSessions().then((sessions) => dispatch({ type: 'sessions', sessions })).catch(() => dispatch({ type: 'sessions', sessions: [] }));
    const t = setInterval(() => fetchSessions().then((sessions) => dispatch({ type: 'sessions', sessions })).catch(() => {}), 15000);
    socket.current = openSocket(
      (msg) => dispatch({ type: 'server', msg }),
      (open) => dispatch({ type: 'socket', open }),
    );
    return () => {
      clearInterval(t);
      socket.current?.close();
    };
  }, []);

  useEffect(() => {
    if (s.batches) setTapeKey((k) => k + 1);
  }, [s.batches]);

  const select = (id: string) => {
    dispatch({ type: 'select', id });
    socket.current?.subscribe(id);
  };

  const current = s.sessions.find((x) => x.id === s.selected);
  const totals = useMemo(() => {
    let output = 0, cacheRead = 0, cacheWrite = 0, calls = 0;
    for (const e of s.events) {
      if (e.kind === 'usage') { output += e.output; cacheRead += e.cacheRead; cacheWrite += e.cacheWrite; }
      if (e.kind === 'tool_call') calls++;
    }
    return { output, cacheRead, cacheWrite, calls };
  }, [s.events]);

  return (
    <div className="app">
      <div key={tapeKey} className={`tape ${tapeKey ? 'advance' : ''}`} aria-hidden />
      <header className="top">
        <div className="brand">
          AgentTrace<small>what the session did, step by step</small>
        </div>
        <div className="status">
          <span><i className={`dot ${s.connected ? 'on' : ''}`} />{s.connected ? 'server connected' : 'server offline'}</span>
          {current && <span><i className={`dot ${current.live ? 'live' : ''}`} />{current.live ? 'session live' : 'session idle'}</span>}
          {current && <span>{totals.calls} tool calls</span>}
          {current && <span>{fmt(totals.output)} out · {fmt(totals.cacheRead)} cached · {fmt(totals.cacheWrite)} written</span>}
        </div>
      </header>
      <div className="body">
        <nav className="rail" aria-label="Sessions">
          <h2>Sessions</h2>
          {s.sessions.length === 0 && <div className="empty">No transcripts found under the projects folder yet.</div>}
          {s.sessions.map((x) => (
            <button key={x.id} className={`sess ${x.id === s.selected ? 'sel' : ''}`} onClick={() => select(x.id)}>
              <span className="t">{x.live && <i className="dot live" />}{x.title}</span>
              <span className="m">{x.updatedAt.slice(0, 16).replace('T', ' ')} · {mb(x.bytes)} <span className="p">· {x.projectSlug.replace(/^.*-code-/, '')}</span></span>
            </button>
          ))}
        </nav>
        <main className="main">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab ${t === tab ? 'sel' : ''}`} onClick={() => setTab(t)} disabled={t !== 'Timeline'} title={t !== 'Timeline' ? 'Coming in a later milestone' : undefined}>
                {t}
              </button>
            ))}
            <div id="tab-tools" className="tools" />
          </div>
          {!current ? (
            <div className="empty">
              <h3>Pick a session on the left.</h3>
              A live session streams as it happens. A past one replays from its first line. Every tool call
              opens on a plain-language line before its raw input.
            </div>
          ) : tab === 'Timeline' ? (
            <Timeline events={s.events} agents={s.agents} loading={s.loading} parseErrors={s.parseErrors} batches={s.batches} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
function mb(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
}
