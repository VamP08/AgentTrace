// The view a session opens on: the session told as a story, for somebody who was not watching.
//
// The headline is the first thing you asked, in your own words. Under it the turns run down a spine
// in the order they happened, each with what it wrote beside it. That order is the point: the one
// study that measured it (Parnin & DeLine, CHI 2010) found people resumed work faster from the raw
// sequence of changes than from a tidy summary, because the sequence carries the order the thinking
// happened in. Every sentence here is read from the transcript, the backups, git or the record;
// the app runs no model, so it never writes a summary of its own.
import { useEffect, useMemo, useState } from 'react';
import type { Digest as DigestData, Event, Session } from '@agenttrace/shared';
import { buildTurns } from './Timeline';
import './story.css';

interface Props {
  sessionId: string;
  session: Session;
  events: Event[];
  live: boolean;
  batches: number;
  agents: number;
  /** open a record entry in its project; the Why rows name lessons, decisions and journal entries */
  onOpenRecord?: (project: string, kind: string, id: string) => boolean;
  onView: (view: 'Turns' | 'Files') => void;
}

/** Turns shown at each end before the middle folds. */
const EDGE = 3;

/** The last digest read per session, so coming back to Story from another tab draws at once. */
const seen = new Map<string, DigestData>();

export function Story({ sessionId, session, events, live, batches, agents, onOpenRecord, onView }: Props) {
  const [d, setD] = useState<DigestData | undefined>(() => seen.get(sessionId));
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [wholePrompt, setWholePrompt] = useState(false);

  // A live session is re-read every ten batches, the same cadence the header uses.
  const tick = Math.floor(batches / 10);
  useEffect(() => {
    let dead = false;
    setFailed(false);
    fetch(`/api/sessions/${sessionId}/digest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((x) => {
        seen.set(sessionId, x);
        if (!dead) setD(x);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
    };
  }, [sessionId, live ? tick : 0]);
  useEffect(() => {
    setD(seen.get(sessionId));
    setAll(false);
    setWholePrompt(false);
  }, [sessionId]);

  // Only turns somebody typed: a task notification or a hook's output arrives as a user message
  // too, and a spine of those tells nobody anything. A slash command is kept, as the command.
  const turns = useMemo(
    () =>
      buildTurns(events).flatMap((t) => {
        const text = said(t.prompt);
        return text === undefined ? [] : [{ ...t, prompt: text }];
      }),
    [events],
  );

  // Each saved version and each commit belongs to the turn whose span holds its time.
  const byTurn = useMemo(() => {
    const out = turns.map(() => ({ wrote: new Map<string, number>(), commits: [] as { sha: string; subject: string }[] }));
    if (!d) return out;
    const at = (ts: string) => {
      let i = -1;
      for (let k = 0; k < turns.length && turns[k].startTs <= ts; k++) i = k;
      return i;
    };
    for (const e of d.edits) {
      const i = at(e.at);
      if (i >= 0) out[i].wrote.set(e.label, e.version);
    }
    for (const c of d.commits) {
      const i = at(c.ts);
      if (i >= 0) out[i].commits.push({ sha: c.sha, subject: c.subject });
    }
    return out;
  }, [turns, d]);

  if (failed) return <div className="empty"><h3>The story could not be read.</h3>The server answered with an error for this session. The Turns view still works.</div>;
  if (!d) return <div className="empty small" aria-busy="true"><h3>Reading the session…</h3>The story joins the transcript, the file backups, git and the record, so it is built when you open it.</div>;

  const first = turns[0]?.prompt ?? d.asked[0] ?? '';
  const long = first.length > 320;
  const folded = !all && turns.length > EDGE * 2 + 1;
  const shown = folded ? [...turns.slice(0, EDGE), ...turns.slice(-EDGE)] : turns;

  return (
    <div className="scroll">
      <article className="story">
        <p className="st-where">Your first words, {clock(session.startedAt)} in {session.cwd}</p>
        {first ? (
          <h1 className={`st-title ${long && !wholePrompt ? 'clamped' : ''}`}>{first}</h1>
        ) : (
          <h1 className="st-title">Nothing was typed in this session.</h1>
        )}
        {long && (
          <button className="st-link" onClick={() => setWholePrompt(!wholePrompt)}>
            {wholePrompt ? 'Show less of the prompt' : 'Show the whole prompt'}
          </button>
        )}
        <p className="st-lede">
          {d.wrote.length > 0
            ? `${d.wrote.length} record ${d.wrote.length === 1 ? 'entry was' : 'entries were'} written during this session. They say why, under Why at the end.`
            : d.missing[0] ?? 'Everything here was read from the transcript, the file backups and git.'}
        </p>

        <dl className="st-figs">
          <div><dt>prompts</dt><dd>{turns.length || d.counts.turns}</dd></div>
          <div><dt>tool calls</dt><dd>{d.counts.calls}</dd></div>
          <div><dt>files written</dt><dd>{d.counts.files}</dd></div>
          <div><dt>saved versions</dt><dd>{d.counts.edits}</dd></div>
          <div><dt>commits</dt><dd>{d.commits.length}</dd></div>
          {agents > 0 && <div><dt>helpers</dt><dd>{agents}</dd></div>}
          {d.counts.failed > 0 && <div className="bad"><dt>failed</dt><dd>{d.counts.failed}</dd></div>}
        </dl>

        <section className="st-sec" aria-labelledby="st-turns">
          <header>
            <h2 id="st-turns">Turns <small>{turns.length}</small></h2>
            <button className="st-link" onClick={() => onView('Turns')}>Every call, in Turns</button>
          </header>
          {turns.length === 0 && <p className="st-note">{events.length === 0 ? 'Reading the transcript…' : 'No prompt was typed in this session.'}</p>}
          <ol className="st-turns">
            {shown.map((t, i) => {
              const at = byTurn[turns.indexOf(t)];
              const gapAfter = folded && i === EDGE - 1;
              const isLast = t === turns[turns.length - 1];
              return (
                <li key={t.n} className={`st-turn ${isLast && live ? 'now' : ''}`}>
                  <span className="st-time">{clock(t.startTs)}</span>
                  <span className="st-mark" aria-hidden />
                  <div className="st-body">
                    <h3>
                      <span className="n">{t.n}</span>
                      {t === turns[0] ? 'Your opening prompt, above' : <span className="p">{t.prompt || '(an image, no words)'}</span>}
                    </h3>
                    {t.lastModelText && <p className="st-reply">{plain(t.lastModelText)}</p>}
                    <p className="st-foot">
                      <span>{t.calls} call{t.calls === 1 ? '' : 's'}</span>
                      <span>{dur(t.startTs, t.endTs)}</span>
                      {t.failed > 0 && <span className="bad">{t.failed} failed</span>}
                      {isLast && live && <span className="live">running now</span>}
                    </p>
                  </div>
                  <div className="st-wrote" hidden={at.wrote.size === 0 && at.commits.length === 0}>
                    {(
                      <>
                        {at.wrote.size > 0 && (
                          <ul>
                            {[...at.wrote].slice(0, 6).map(([label, v]) => (
                              <li key={label}><span className="f" title={label}>{label}</span><span className="v">v{v}</span></li>
                            ))}
                            {at.wrote.size > 6 && <li className="more">and {at.wrote.size - 6} more</li>}
                          </ul>
                        )}
                        {at.commits.map((c) => (
                          <p key={c.sha} className="st-commit"><span className="sha">{c.sha.slice(0, 7)}</span>{c.subject}</p>
                        ))}
                      </>
                    )}
                  </div>
                  {gapAfter && (
                    <button className="st-fold" onClick={() => setAll(true)}>
                      Show {turns.length - EDGE * 2} more turns, {turns[EDGE].n} to {turns[turns.length - EDGE - 1].n}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="st-sec" aria-labelledby="st-files">
          <header>
            <h2 id="st-files">Files <small>{d.files.length}</small></h2>
            <button className="st-link" onClick={() => onView('Files')}>Every version, in Files</button>
          </header>
          {d.files.length === 0 ? (
            <p className="st-note">No file was written in this session.</p>
          ) : (
            <ul className="st-rows">
              {[...d.files].sort((a, b) => b.edits - a.edits).slice(0, 12).map((f) => (
                <li key={f.path}>
                  <span className="p" title={f.path}>{f.label}</span>
                  <span className="c">{f.edits} version{f.edits === 1 ? '' : 's'}</span>
                  <span className="c">{delta(f.delta)}</span>
                </li>
              ))}
            </ul>
          )}
          {d.files.length > 12 && <p className="st-note">The twelve rewritten most. All {d.files.length} are in Files.</p>}
        </section>

        <section className="st-sec" aria-labelledby="st-why">
          <header><h2 id="st-why">Why</h2></header>
          {d.wrote.length === 0 ? (
            <p className="st-note">{d.missing.find((m) => m.includes('record')) ?? 'No record entry names this session.'}</p>
          ) : (
            <ul className="st-rows">
              {d.wrote.map((w) => (
                <li key={`${w.kind}:${w.project}:${w.id}`}>
                  <span className="k">{w.kind}</span>
                  <span className="p">
                    {onOpenRecord ? <button className="st-open" onClick={() => onOpenRecord(w.project, w.kind, w.id)}>{w.title}</button> : w.title}
                    {w.summary && <span className="s">{w.summary}</span>}
                  </span>
                  <span className="c">{w.project}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="st-sec" aria-labelledby="st-commits">
          <header><h2 id="st-commits">Committed <small>{d.commits.length}</small></h2></header>
          {d.commits.length === 0 ? (
            <p className="st-note">Nothing was committed while this session ran.</p>
          ) : (
            <ul className="st-rows">
              {d.commits.map((c) => (
                <li key={c.sha}>
                  <span className="t">{clock(c.ts)}</span>
                  <span className="p">{c.subject}</span>
                  <span className="c">{c.repo}</span>
                  <span className="sha">{c.sha.slice(0, 7)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {d.helpers.length > 0 && (
          <section className="st-sec" aria-labelledby="st-helpers">
            <header><h2 id="st-helpers">Helpers <small>{d.helpers.length}</small></h2></header>
            <ul className="st-rows">
              {d.helpers.map((h, i) => (
                <li key={i}>
                  <span className="k">{h.agentType}</span>
                  <span className="p">{h.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}

/** What the person typed, or undefined when the tool wrote the message. A command shows as the command. */
function said(prompt: string): string | undefined {
  const t = prompt.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').trim();
  const cmd = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(t);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1].trim();
    return args ? `${cmd[1]} ${args}` : cmd[1];
  }
  if (!t || /^<[a-z][a-z0-9-]*>/i.test(t) || /^\[Request interrupted/.test(t)) return undefined;
  return t;
}
/** A reply is Markdown; the story shows its words, not its asterisks and backticks. */
function plain(md: string): string {
  return md.replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '');
}
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function dur(from: string, to: string): string {
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function size(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`;
}
function delta(b: number): string {
  if (b === 0) return 'same size';
  return `${b > 0 ? '+' : '−'}${size(Math.abs(b))}`;
}
