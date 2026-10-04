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
  const [hover, setHover] = useState<number>();
  const turns = useMemo(() => buildTurns(events), [events]);

  const rows = useMemo(() => {
    return turns.map((t) => {
      let output = 0, cacheRead = 0, cacheWrite = 0, input = 0, calls = 0;
      let lastContext = 0;
      const replies: number[] = []; // the context each reply was billed on, in order
      const ctx: { source: string; content: string; ts: string }[] = [];
      for (const e of t.events) {
        if (e.kind === 'usage') { output += e.output; cacheRead += e.cacheRead; cacheWrite += e.cacheWrite; input += e.input; calls++; lastContext = e.cacheRead + e.cacheWrite + e.input; replies.push(lastContext); }
        if (e.kind === 'context') ctx.push({ source: e.source, content: e.content, ts: e.ts });
      }
      return { t, output, cacheRead, cacheWrite, input, calls, ctx, lastContext, replies };
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
          Every reply is billed on what the model had to read, the context, and on what it wrote. The chart shows the
          context after every reply: it grows as the session goes on and falls where the tool compacted it. Open a turn
          below to see what entered the context without you typing it: hooks, skills, reminders.
        </p>
      </section>
      <Curve rows={rows} active={hover ?? open} open={open} onHover={setHover} onOpen={(n) => setOpen(open === n ? undefined : n)} />
      <div className="ctx-table">
        <div className="ctx-head"><span>Turn</span><span>Context at end</span><span>Written</span><span>Replies</span></div>
        {rows.map((r, i) => {
          // A turn with no reply, /compact, has no context of its own to show; when the context fell
          // across it, that turn is where the compaction is said. A fall between two replying turns is
          // the tool compacting on its own, and is said on the turn that fell.
          const prev = rows.slice(0, i).reverse().find((x) => x.lastContext > 0)?.lastContext ?? 0;
          const after = rows.slice(i + 1).find((x) => x.replies.length)?.replies[0] ?? 0;
          const cutHere = r.calls === 0 && prev > 0 && after > 0 && after < prev * 0.9;
          const fellHere = r.calls > 0 && i > 0 && rows[i - 1].calls > 0 && r.replies[0] < rows[i - 1].lastContext * 0.9;
          const lit = hover === r.t.n || open === r.t.n;
          return (
          <div key={r.t.n} className={`ctx-row ${lit ? 'lit' : ''}`} onMouseEnter={() => setHover(r.t.n)} onMouseLeave={() => setHover(undefined)}>
            <button className="ctx-line" onClick={() => setOpen(open === r.t.n ? undefined : r.t.n)} aria-expanded={open === r.t.n}>
              <span className="n"><span className={`chev ${open === r.t.n ? '' : 'closed'}`} aria-hidden />{r.t.n}</span>
              <span className="p">{label(r.t.prompt)}</span>
              {r.calls === 0 ? (
                <span className="cut">{cutHere ? <>compacted <i className="mono">{fmt(prev)} to {fmt(after)}</i></> : ''}</span>
              ) : (
                <span className="bar">
                  <i style={{ width: `${(r.lastContext / maxCtx) * 100}%` }} />
                  {fellHere && <em>compacted</em>}
                  <b>{fmt(r.lastContext)}</b>
                </span>
              )}
              {r.calls === 0 ? <span /> : <span className="bar out"><i style={{ width: `${(r.output / maxOut) * 100}%` }} /><b>{fmt(r.output)}</b></span>}
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
      <section className="ctx-hooks" aria-label="Hook events">
        <h3>Hook events this session</h3>
        {hooks && <p className="mono">{Object.entries(hooks.counts).map(([k, n]) => `${n} ${k}`).join('  ·  ')}</p>}
        {hooks === null && <p>No hook log for this session. Install the hooks once with <code>node hooks/install-settings.mjs</code> and later sessions will carry tool timings and permission events here.</p>}
      </section>
    </div>
  );
}

type Row = { t: { n: number; prompt: string }; replies: number[]; output: number };

/**
 * The context after every reply, across the whole session, as steps: each reply holds its value
 * until the next one. Turns are regions along the bottom; the one hovered or opened is drawn in the
 * accent, because that is what violet means here. Where the context falls, the tool compacted it,
 * and the drop is labelled with both sizes. The table below stays the keyboard path; the chart only
 * mirrors it.
 */
function Curve({ rows, active, open, onHover, onOpen }: { rows: Row[]; active?: number; open?: number; onHover: (n?: number) => void; onOpen: (n: number) => void }) {
  const pts = rows.flatMap((r) => r.replies.map((c) => ({ n: r.t.n, c })));
  if (pts.length < 2) return null;
  const n = pts.length;
  const top = Math.max(...pts.map((p) => p.c));
  const step = 10 ** Math.floor(Math.log10(top));
  const max = Math.ceil((top * 1.08) / step) * step; // headroom, on a round number
  const x = (k: number) => (k / n) * 100; // percent of the width
  const y = (c: number) => 100 - (c / max) * 100;
  const line = pts.map((p, k) => `${k ? 'V' : 'M0 '}${y(p.c)}H${x(k + 1)}`).join('');
  const area = `${line}V100H0Z`;
  const spans = rows
    .map((r) => {
      const first = pts.findIndex((p) => p.n === r.t.n);
      return first < 0 ? null : { n: r.t.n, from: first, to: first + r.replies.length };
    })
    .filter((s): s is { n: number; from: number; to: number } => !!s);
  // a turn with no reply (/compact) has no width; it is marked where the next reply starts
  const marks = rows.filter((r) => !r.replies.length).map((r) => ({ n: r.t.n, at: pts.findIndex((p) => p.n > r.t.n) })).filter((m) => m.at > 0);
  const tick = (v: number) => (v === 0 ? '0' : `${Math.round(v / 1000)}k`);
  const drops = pts.flatMap((p, k) => (k > 0 && p.c < pts[k - 1].c * 0.9 ? [{ k, before: pts[k - 1].c, after: p.c }] : []));
  const on = spans.find((s) => s.n === active);
  const row = rows.find((r) => r.t.n === active);
  const peak = Math.max(...pts.map((p) => p.c));

  return (
    <figure className="ctx-curve" aria-label="Context after every reply">
      <figcaption className="ctx-read">
        {on && row ? (
          <>
            <b>Turn {on.n}</b> <span className="p">{label(row.t.prompt)}</span>
            <span className="mono">{fmt(row.replies[0])} to {fmt(row.replies[row.replies.length - 1])}, {row.replies.length} {row.replies.length === 1 ? 'reply' : 'replies'}</span>
          </>
        ) : (
          <>
            <b>Context after every reply</b>
            <span className="mono">peak {fmt(peak)}, {n} replies{drops.length ? `, compacted ${drops.length === 1 ? 'once' : `${drops.length} times`}` : ''}</span>
          </>
        )}
      </figcaption>
      <div className="plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>{on && <clipPath id="ctx-on"><rect x={x(on.from)} y="0" width={x(on.to) - x(on.from)} height="100" /></clipPath>}</defs>
          <path className="area" d={area} />
          <path className="line" d={line} />
          {on && (
            <g clipPath="url(#ctx-on)" className="on">
              <path className="area" d={area} />
              <path className="line" d={line} />
            </g>
          )}
        </svg>
        {/* drawn over the area, so a gridline stays visible where the curve is above it */}
        {[1, 0.5, 0].map((f) => (
          <span key={f} className={`grid ${f === 0 ? 'base' : ''}`} style={{ top: `${y(max * f)}%` }}><i className="mono">{tick(max * f)}</i></span>
        ))}
        {drops.map((d) => (
          <span key={d.k} className={`cut ${x(d.k) > 62 ? 'left' : ''}`} style={{ left: `${x(d.k)}%`, top: `${y(d.before)}%` }}>
            compacted <i className="mono">{fmt(d.before)} to {fmt(d.after)}</i>
          </span>
        ))}
        {spans.map((s) => (
          <button
            key={s.n}
            className={`hit ${s.n === active ? 'on' : ''} ${s.n === open ? 'open' : ''}`}
            style={{ left: `${x(s.from)}%`, width: `${x(s.to) - x(s.from)}%` }}
            onMouseEnter={() => onHover(s.n)}
            onMouseLeave={() => onHover(undefined)}
            onClick={() => onOpen(s.n)}
            tabIndex={-1}
            aria-hidden
          >
            <i className="mono">{s.n}</i>
          </button>
        ))}
        {marks.map((m) => <span key={m.n} className={`mark ${m.n === open ? 'open' : ''}`} style={{ left: `${x(m.at)}%` }}><i className="mono">{m.n}</i></span>)}
        <span className="axis mono">turn</span>
      </div>
    </figure>
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
