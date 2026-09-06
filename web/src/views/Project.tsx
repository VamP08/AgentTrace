// A project is one GitHub repository. Its page gathers the sessions that worked in it, from
// wherever they were started, so a repository's story is in one place.
import { useEffect, useState } from 'react';
import type { ProjectDetail, ProjectDocument } from '@agenttrace/shared';
import { Markdown } from '../components/Markdown';
import { Learn } from './Learn';
import './read.css';

type Tab = 'Overview' | 'Learn' | 'Documents';

interface Props {
  id: string;
  onOpenSession: (sessionId: string) => void;
  onOpenProject: (id: string) => void;
}

export function Project({ id, onOpenSession, onOpenProject }: Props) {
  const [p, setP] = useState<ProjectDetail | null | undefined>();
  const [tab, setTab] = useState<Tab>('Overview');

  useEffect(() => {
    setP(undefined);
    setTab('Overview');
    fetch(`/api/projects/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setP)
      .catch(() => setP(null));
  }, [id]);

  if (p === undefined) return <div className="empty rd-empty" aria-busy="true">Gathering every session for this repository…</div>;
  if (p === null) return <div className="empty rd-empty">This project is no longer in the index. Reopen it from the sidebar.</div>;

  const mainCount = p.sessionList.filter((s) => s.primary && !s.byCwdOnly).length;

  return (
    <>
      <header className="head">
        <div className="row1">
          <h2 title={p.root}>{p.name}</h2>
          <span className={`pill ${p.live ? 'live' : ''}`}>{p.live ? 'Live' : 'Idle'}</span>
          <span className="pill">{p.kind === 'github' ? 'GitHub' : 'not on GitHub yet'}</span>
        </div>
        <div className="meta">
          <span>Working copy <b title={p.root}>{p.root}</b></span>
          {p.remote && <span>Remote <b>{p.remote.replace(/^https?:\/\//, '').replace(/\.git$/, '')}</b></span>}
          <span>Sessions <b>{p.sessionList.length}</b></span>
          <span>Files written <b>{p.edits}</b></span>
          <span>Tool calls <b>{p.calls}</b></span>
          {p.failed > 0 && <span>Failed <b>{p.failed}</b></span>}
        </div>
        <div className="row2">
          <div className="seg" role="tablist">
            {(['Overview', 'Learn', 'Documents'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="stage">
        {tab === 'Learn' && <Learn base={`/api/projects/${encodeURIComponent(p.id)}/record`} cwd={p.root} />}
        {tab === 'Documents' && <Documents id={p.id} />}
        {tab === 'Overview' && (
        <div className="scroll rd-regions">
          <section className="rd-region">
            <h3 className="rd-region-h">What this project is</h3>
            <p>
              Every session that wrote files into <code>{p.root}</code>, wherever it was started. A session that also worked in
              another repository is listed there too; here it carries the number of files it wrote in this one.
            </p>
            <div className="rd-figs">
              <Stat n={p.sessionList.length} label="sessions" />
              <Stat n={mainCount} label="mainly here" />
              <Stat n={p.edits} label="files written" />
              <Stat n={p.calls} label="tool calls" />
              <Stat n={p.failed} label="failed" tone={p.failed ? 'fail' : undefined} />
              <Stat n={span(p.firstTs, p.lastTs)} label="from first to last" />
            </div>
          </section>

          {p.neighbours.length > 0 && (
            <section className="rd-region">
              <h3 className="rd-region-h">Worked alongside</h3>
              <div className="rd-row">
                {p.neighbours.map((n) => (
                  <button key={n.id} className="rd-chip" onClick={() => onOpenProject(n.id)}>{n.name} · {n.sessions} shared session{n.sessions === 1 ? '' : 's'}</button>
                ))}
              </div>
            </section>
          )}

          <section className="rd-region">
            <h3 className="rd-region-h">Sessions</h3>
            {byDay(p.sessionList).map((d) => (
              <div className="rd-day" key={d.key}>
                <div className="rd-day-h">{d.label}</div>
                {d.sessions.map((s) => (
                  <button className="rd-sess" key={s.id} title={s.title} onClick={() => onOpenSession(s.id)}>
                    <span className="rd-time">{clock(s.updatedAt)}</span>
                    <span className="rd-t">{s.live && <span className="rd-live"><i className="dot pulse" />Live</span>}{s.title}</span>
                    <span className="rd-m">
                      {s.byCwdOnly ? 'ran here, wrote nothing' : `${s.edits} file${s.edits === 1 ? '' : 's'} written${s.primary ? '' : ', mainly elsewhere'}`} · {s.calls} calls{s.failed ? ` · ${s.failed} failed` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </section>

          {p.gone && (
            <section className="rd-region">
              <h3 className="rd-region-h">Folder no longer on disk</h3>
              <p><code>{p.root}</code> is gone. Its name, remote and record path are what AgentTrace remembered while it existed. The sessions are archived and still open; commits cannot be shown without the folder.</p>
            </section>
          )}
          {p.recordRoot && p.recordMissing ? (
            <section className="rd-region">
              <h3 className="rd-region-h">Record folder missing</h3>
              <p>The record for this repository is named at <code>{p.recordRoot}</code>, but that folder is not on disk. Put it back, or point <code>agenttrace.json</code> at its new place and run <code>node ~/.claude/skills/agenttrace/register.mjs</code> in the repository.</p>
            </section>
          ) : p.recordRoot ? (
            <section className="rd-region">
              <h3 className="rd-region-h">Record</h3>
              <p>Lessons for this repository are kept in <code>{p.recordRoot}</code>.</p>
              <div className="rd-row"><button className="btn primary" onClick={() => setTab('Learn')}>Open the lessons</button></div>
            </section>
          ) : (
            <section className="rd-region">
              <h3 className="rd-region-h">No record yet</h3>
              <p>This repository keeps no lessons. Open a coding session inside it and run <code>/agenttrace backfill</code>. The skill asks where the record should live, fetches this repository's history from AgentTrace while it is running, and writes the record from what happened: stack, milestones, one journal entry per session, and a lesson for each technology. From then on every session adds to it as it builds.</p>
            </section>
          )}
        </div>
        )}
      </div>
    </>
  );
}

const GROUPS = [
  { where: 'repository' as const, title: 'In the repository' },
  { where: 'notes' as const, title: 'Beside the record' },
];

/** The documents the project already keeps, shown as they are on disk. Nothing here writes. */
function Documents({ id }: { id: string }) {
  const base = `/api/projects/${encodeURIComponent(id)}/documents`;
  const [list, setList] = useState<ProjectDocument[] | null | undefined>();
  const [pick, setPick] = useState<string>();

  useEffect(() => {
    setList(undefined);
    setPick(undefined);
    fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then(setList)
      .catch(() => setList(null));
  }, [base]);

  if (list === undefined) return <div className="empty rd-empty" aria-busy="true">Looking for the documents this project keeps…</div>;
  if (list === null) return <div className="empty rd-empty">The documents could not be read.</div>;
  if (list.length === 0) return <div className="empty rd-empty">This project keeps no documents the app can show.</div>;

  const chosen = list.find((d) => d.path === pick);

  return (
    <div className="split">
      <aside className="files rd-rail">
        {GROUPS.filter((g) => list.some((d) => d.where === g.where)).map((g) => (
          <div key={g.where}>
            <h3 className="rd-rail-h">{g.title}</h3>
            {list.filter((d) => d.where === g.where).map((d) => (
              <button key={d.path} className={`node rd-entry ${pick === d.path ? 'sel' : ''}`} onClick={() => setPick(d.path)} title={d.path}>
                <span className="rd-t">{d.label}</span>
                <span className="rd-m">{size(d.bytes)} · {day(d.modified)}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="rd-pane">
        {!chosen && (
          <div className="empty rd-empty">
            <h3>{list.length} document{list.length === 1 ? '' : 's'} this project already keeps.</h3>
            Pick one to read it. They are shown as they are on disk and never changed here; the record in the Learn tab is
            the only thing AgentTrace writes.
          </div>
        )}
        {chosen && <Document key={chosen.path} base={base} doc={chosen} />}
      </section>
    </div>
  );
}

/** One document, fetched by its own path. Keyed on it, so switching never shows the last one's text. */
function Document({ base, doc }: { base: string; doc: ProjectDocument }) {
  const [body, setBody] = useState<{ path: string; content: string } | null | undefined>();

  useEffect(() => {
    fetch(`${base}?file=${encodeURIComponent(doc.path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBody)
      .catch(() => setBody(null));
  }, [base, doc.path]);

  if (body === undefined) return <div className="empty rd-empty" aria-busy="true">Reading {doc.label}…</div>;
  if (body === null) return <div className="empty rd-empty">That document could not be read. It may have moved since the list was made.</div>;

  return (
    <article className="rd-read">
      <h2>{doc.label}</h2>
      <div className="rd-meta rd-meta-under">
        <span className="pill">{doc.where === 'notes' ? 'beside the record' : 'in the repository'}</span>
        <span className="rd-path" title={doc.path}>{doc.path}</span>
      </div>
      {/\.md$/i.test(doc.path) ? <Markdown text={body.content} /> : <pre className="code">{body.content}</pre>}
    </article>
  );
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: 'fail' }) {
  return (
    <div className={`rd-fig ${tone ?? ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** A stored timestamp as the reader's own day. Anything unparseable is shown as it was stored. */
function day(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : DAY.format(d);
}
function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : CLOCK.format(d);
}

/**
 * The session list as a strip of days: sessions arrive newest first, so consecutive runs on the
 * same local day fold into one group and the date is written once instead of forty times.
 */
function byDay(list: ProjectDetail['sessionList']) {
  const days: { key: string; label: string; sessions: ProjectDetail['sessionList'] }[] = [];
  for (const s of list) {
    const d = new Date(s.updatedAt);
    const key = Number.isNaN(d.getTime()) ? s.updatedAt : d.toDateString();
    const last = days[days.length - 1];
    if (last && last.key === key) last.sessions.push(s);
    else days.push({ key, label: day(s.updatedAt), sessions: [s] });
  }
  return days;
}

function span(a: string, b: string): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'one sitting';
  const d = Math.round(ms / 86_400_000);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
  const h = Math.round(ms / 3_600_000);
  return h >= 1 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(ms / 60_000)} min`;
}
