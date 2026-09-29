// What entered the model's context and what it cost, turn by turn. Numbers come from the
// transcript's usage records; the bars are drawn from those numbers and nothing else.
import { useMemo, useState } from 'react';
import type { Event } from '@agenttrace/shared';
import { buildTurns } from './Timeline';
import { said } from '../prompt';

interface HookSummary {
  events: { event: string; ts: string; toolName?: string; durationMs?: number; note?: string }[];
  counts: Record<string, number>;
  sessionStart?: string;
  sessionEnd?: string;
}

interface Props {
  events: Event[];
  hooks?: HookSummary | null;
}

export function Context({ events, hooks }: Props) {
  const [open, setOpen] = useState<number>();
  const turns = useMemo(() => buildTurns(events), [events]);

  const rows = useMemo(() => {
    return turns.map((t) => {
      let output = 0, cacheRead = 0, cacheWrite = 0, input = 0, calls = 0;
      let lastContext = 0;
      const ctx: { source: string; content: string; ts: string }[] = [];
      for (const e of t.events) {
        if (e.kind === 'usage') { output += e.output; cacheRead += e.cacheRead; cacheWrite += e.cacheWrite; input += e.input; calls++; lastContext = e.cacheRead + e.cacheWrite + e.input; }
        if (e.kind === 'context') ctx.push({ source: e.source, content: e.content, ts: e.ts });
      }
      return { t, output, cacheRead, cacheWrite, input, calls, ctx, lastContext };
    });
  }, [turns]);

  const maxCtx = Math.max(1, ...rows.map((r) => r.lastContext));
  const maxOut = Math.max(1, ...rows.map((r) => r.output));

  if (turns.length === 0)
    return (
      <div className="empty">
        <h3>No turns yet.</h3>
        Nothing has been billed against this session, because no prompt has been answered in it yet.
      </div>
    );

  return (
    <div className="scroll ctx-page">
      <section className="explainer" aria-label="How to read this">
        <h3>Context, turn by turn</h3>
        <p>
          Each model reply is billed on what it had to read (the context) and what it wrote (the output). Cached reading is
          cheaper than fresh reading. The context bar shows the size of the conversation the model saw at the end of the turn;
          it grows as the session goes on and shrinks when the tool compacts it. Expand a turn to see what was added to the
          context without you typing it: hooks, skills, reminders.
        </p>
        {hooks && (
          <div className="now-grid">
            {Object.entries(hooks.counts).map(([k, n]) => (
              <div className="stat" key={k}><b>{n}</b><span>{k}</span></div>
            ))}
          </div>
        )}
        {hooks === null && <p>No hook log for this session. Install the hooks once with <code>node hooks/install-settings.mjs</code> and later sessions will carry tool timings and permission events here.</p>}
      </section>
      <div className="ctx-table">
        <div className="ctx-head"><span>Turn</span><span>Context at end</span><span>Written</span><span>Replies</span></div>
        {rows.map((r, i) => {
          // The context shrank: the tool compacted it. The mark sits where the previous turn ended.
          const prev = i > 0 ? rows[i - 1].lastContext : 0;
          const compacted = prev > 0 && r.lastContext > 0 && r.lastContext < prev;
          return (
          <div key={r.t.n} className="ctx-row">
            <button className="ctx-line" onClick={() => setOpen(open === r.t.n ? undefined : r.t.n)} aria-expanded={open === r.t.n}>
              <span className="n">{r.t.n}</span>
              <span className="p">{label(r.t.prompt)}</span>
              <span className="bar">
                <i style={{ width: `${(r.lastContext / maxCtx) * 100}%` }} />
                {compacted && <u style={{ left: `${(prev / maxCtx) * 100}%` }} />}
                {compacted && <em>compacted</em>}
                <b>{fmt(r.lastContext)}</b>
              </span>
              <span className="bar out"><i style={{ width: `${(r.output / maxOut) * 100}%` }} /><b>{fmt(r.output)}</b></span>
              <span className="c">{r.calls === 0 ? 'no reply' : r.calls}</span>
            </button>
            {open === r.t.n && (
              <div className="ctx-detail">
                <div className="now-grid">
                  <div className="stat"><b>{fmt(r.cacheRead)}</b><span>read from cache</span></div>
                  <div className="stat"><b>{fmt(r.cacheWrite)}</b><span>written to cache</span></div>
                  <div className="stat"><b>{fmt(r.input)}</b><span>read fresh</span></div>
                  <div className="stat"><b>{fmt(r.output)}</b><span>output</span></div>
                </div>
                {r.ctx.length === 0 && <p className="now-p">Nothing entered the context this turn beyond your prompt and the tool results.</p>}
                {r.ctx.map((c, j) => (
                  <details key={j} className="ctx-item">
                    <summary><span className="mono">{c.source}</span> <span className="c">{c.content.length.toLocaleString()} characters</span></summary>
                    <pre>{c.content.slice(0, 4000)}{c.content.length > 4000 ? '\n…' : ''}</pre>
                  </details>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

// Some turns are not typed by a person: the tool injects a bracketed tag. Printing the raw tag
// makes the table look broken; the row is real and gets said in words instead.
function label(prompt: string): string {
  const typed = said(prompt);
  if (typed) return typed.split('\n')[0];
  return /<task-notification>/i.test(prompt) ? 'System notification' : 'System message';
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
