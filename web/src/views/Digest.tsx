// The catch-up view: what a session changed and why, for somebody who was not watching.
//
// The edits are raw and chronological, oldest first, one row per saved version. Grouping them by
// file is a toggle that starts off. That is not a taste call: the one study that measured it
// (Parnin & DeLine, CHI 2010) found people resumed work faster from the raw sequence of changes
// than from a tidy summary of them, because the sequence carries the order the thinking happened in.
import { useEffect, useState } from 'react';
import type { Digest as DigestData } from '@agenttrace/shared';

interface Props {
  sessionId: string;
  live: boolean;
  batches: number;
  /** open a record entry in its project; the Why rows name lessons, decisions and journal entries */
  onOpenRecord?: (project: string, kind: string, id: string) => boolean;
}

export function Digest({ sessionId, live, batches, onOpenRecord }: Props) {
  const [d, setD] = useState<DigestData>();
  const [failed, setFailed] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [allAsked, setAllAsked] = useState(false);
  const [allCommits, setAllCommits] = useState(false);
  const [allWrote, setAllWrote] = useState(false);
  const [how, setHow] = useState(false);

  // A live session is re-read every ten batches, the same cadence the header uses.
  const tick = Math.floor(batches / 10);
  useEffect(() => {
    let dead = false;
    setD(undefined);
    setFailed(false);
    fetch(`/api/sessions/${sessionId}/digest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((x) => !dead && setD(x))
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
    };
  }, [sessionId, live ? tick : 0]);

  if (failed) return <div className="empty"><h3>The digest could not be read.</h3>The server answered with an error for this session. The Turns view still works.</div>;
  if (!d) return <div className="empty small"><h3>Reading the session…</h3>The digest joins the transcript, the file backups, git and the record, so it is built when you open it.</div>;

  const edits = grouped ? [] : d.edits;
  return (
    <div className="scroll">
      <section className="explainer" aria-label="How to read this">
        {/* The prose is read once and then never again, and it was costing the first screen the one
            thing the screen is for: the list of what changed. Same rule the tool cards already
            follow — explanation on demand, not on every load. */}
        <h3>
          What changed, and why
          <button className="btn sm quiet" onClick={() => setHow(!how)} aria-expanded={how}>
            {how ? 'Hide how this is built' : 'How this is built'}
          </button>
        </h3>
        {how && (
          <p>
            Everything on this page was read from files the session left behind: the prompts from the transcript, the changes
            from the file backups the coding tool saved, the commits from git, and the reasoning from the project's record.
            Nothing here was summarised by a model, because this app runs none.
          </p>
        )}
        <div className="now-grid">
          <div className="stat"><b>{d.counts.turns}</b><span>{plural(d.counts.turns, 'thing asked', 'things asked')}</span></div>
          <div className="stat"><b>{d.counts.files}</b><span>{plural(d.counts.files, 'file touched', 'files touched')}</span></div>
          <div className="stat"><b>{d.counts.edits}</b><span>{plural(d.counts.edits, 'saved version', 'saved versions')}</span></div>
          <div className="stat"><b>{d.commits.length}</b><span>{plural(d.commits.length, 'commit', 'commits')}</span></div>
          {d.counts.failed > 0 && <div className="stat fail"><b>{d.counts.failed}</b><span>{plural(d.counts.failed, 'failed call', 'failed calls')}</span></div>}
        </div>
      </section>

      {/* Two columns on a wide screen, for the gate rather than for looks: with everything in one
          column the list of what changed started below the fold on any session with more than a
          handful of files, which is the one thing this screen exists to show. Source order is the
          reading order, and below 1120px it is the only order. */}
      <div className="dg-cols">
      <div className="dg-side">
      <section className="dg" aria-labelledby="dg-asked">
        <h3 id="dg-asked">Asked</h3>
        {d.asked.length === 0 ? (
          <p className="now-p">Nothing was typed in this session.</p>
        ) : (
          <ol className="dg-asked">
            {(allAsked ? d.asked : d.asked.slice(0, 2)).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        )}
        {d.asked.length > 2 && (
          <button className="btn sm quiet" onClick={() => setAllAsked(!allAsked)}>
            {allAsked ? 'Show the first two' : `Show all ${d.asked.length}`}
          </button>
        )}
      </section>

      <section className="dg" aria-labelledby="dg-why">
        <h3 id="dg-why">
          Why
          {d.wrote.length > 4 && (
            <button className="btn sm quiet" onClick={() => setAllWrote(!allWrote)}>
              {allWrote ? 'Show the first four' : `Show all ${d.wrote.length}`}
            </button>
          )}
        </h3>
        {d.wrote.length === 0 ? (
          <p className="now-p">{d.missing.find((m) => m.includes('record')) ?? 'No record entry names this session.'}</p>
        ) : (
          <ul className="dg-notes">
            {(allWrote ? d.wrote : d.wrote.slice(0, 4)).map((w) => (
              <li key={`${w.kind}:${w.project}:${w.id}`}>
                <span className="kind">{w.kind}</span>
                <span className="t">
                  {onOpenRecord ? <button className="dg-open" onClick={() => onOpenRecord(w.project, w.kind, w.id)} title={`Open this ${w.kind}`}>{w.title}</button> : w.title}
                </span>
                <span className="c">{w.project}{w.summary ? ` · ${w.summary}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      </div>
      <div className="dg-main">
      <section className="dg" aria-labelledby="dg-changed">
        <h3 id="dg-changed">
          Changed
          <button className="btn sm quiet" onClick={() => setGrouped(!grouped)} aria-pressed={grouped}>
            {grouped ? 'Show each change in order' : 'Group by file'}
          </button>
        </h3>
        <p className="now-p small">
          {grouped
            ? 'One row per file, in the order each was first touched. The order of the individual changes is lost here.'
            : 'One row per saved version, oldest first. This is the order the work actually happened in.'}
        </p>
        {d.counts.edits === 0 ? (
          <p className="now-p">No file was written in this session.</p>
        ) : grouped ? (
          <ul className="dg-rows">
            {d.files.map((f) => (
              <li key={f.path}>
                <span className="time">{clock(f.first)}</span>
                <span className="p" title={f.path}>{f.label}</span>
                <span className="c">{f.edits} change{f.edits === 1 ? '' : 's'}</span>
                <span className={`d ${f.delta > 0 ? 'add' : f.delta < 0 ? 'del' : ''}`}>{delta(f.delta)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="dg-rows">
            {edits.map((e, i) => (
              <li key={`${e.path}@${e.version}@${i}`}>
                <span className="time">{clock(e.at)}</span>
                <span className="p" title={e.path}>{e.label}</span>
                <span className="c">{e.delta === undefined ? 'first copy this session' : `version ${e.version}`}</span>
                <span className={`d ${(e.delta ?? 0) > 0 ? 'add' : (e.delta ?? 0) < 0 ? 'del' : ''}`}>{e.delta === undefined ? size(e.bytes) : delta(e.delta)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dg" aria-labelledby="dg-committed">
        <h3 id="dg-committed">
          Committed
          {d.commits.length > 10 && (
            <button className="btn sm quiet" onClick={() => setAllCommits(!allCommits)}>
              {allCommits ? 'Show the last ten' : `Show all ${d.commits.length}`}
            </button>
          )}
        </h3>
        {d.commits.length === 0 ? (
          <p className="now-p">Nothing was committed while this session ran.</p>
        ) : (
          <ul className="dg-rows">
            {(allCommits ? d.commits : d.commits.slice(0, 10)).map((c) => (
              <li key={c.sha}>
                <span className="time">{clock(c.ts)}</span>
                <span className="p">{c.subject}</span>
                <span className="c">{c.repo}</span>
                <span className="d mono">{c.sha}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.helpers.length > 0 && (
        <section className="dg" aria-labelledby="dg-helpers">
          <h3 id="dg-helpers">Helpers</h3>
          <ul className="dg-notes">
            {d.helpers.map((h, i) => (
              <li key={i}>
                <span className="kind">{h.agentType}</span>
                <span className="t">{h.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
      </div>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function size(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`;
}
function delta(b: number): string {
  if (b === 0) return 'no change in size';
  return `${b > 0 ? '+' : '−'}${size(Math.abs(b))}`;
}
