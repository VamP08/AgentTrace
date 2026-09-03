// A project is one GitHub repository. Its page gathers the sessions that worked in it, from
// wherever they were started, so a repository's story is in one place.
import { useEffect, useState } from 'react';
import type { ProjectDetail } from '@agenttrace/shared';
import { Learn } from './Learn';

type Tab = 'Overview' | 'Learn';

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

  if (p === undefined) return <div className="empty" aria-busy="true">Gathering every session for this repository…</div>;
  if (p === null) return <div className="empty">This project is no longer in the index. Reopen it from the sidebar.</div>;

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
            {(['Overview', 'Learn'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="stage">
        {tab === 'Learn' && <Learn base={`/api/projects/${encodeURIComponent(p.id)}/record`} cwd={p.root} />}
        {tab === 'Overview' && (
        <div className="scroll">
          <section className="now idle">
            <div className="now-h">What this project is</div>
            <p className="now-p">
              Every session that wrote files into <code>{p.root}</code>, wherever it was started. A session that also worked in
              another repository is listed there too; here it carries the number of files it wrote in this one.
            </p>
            <div className="now-grid">
              <Stat n={p.sessionList.length} label="sessions" />
              <Stat n={mainCount} label="mainly here" />
              <Stat n={p.edits} label="files written" />
              <Stat n={p.calls} label="tool calls" />
              <Stat n={p.failed} label="failed" tone={p.failed ? 'fail' : undefined} />
              <Stat n={span(p.firstTs, p.lastTs)} label="from first to last" />
            </div>
          </section>

          {p.neighbours.length > 0 && (
            <section className="now idle">
              <div className="now-h">Worked alongside</div>
              <div className="doc-files">
                {p.neighbours.map((n) => (
                  <button key={n.id} className="chip" onClick={() => onOpenProject(n.id)}>{n.name} · {n.sessions} shared session{n.sessions === 1 ? '' : 's'}</button>
                ))}
              </div>
            </section>
          )}

          <section className="now idle">
            <div className="now-h">Sessions</div>
            <div className="ctx-table">
              {p.sessionList.map((s) => (
                <button className="ctx-line day" key={s.id} onClick={() => onOpenSession(s.id)}>
                  <span className="n">{s.updatedAt.slice(0, 10)}</span>
                  <span className="p">{s.live && <i className="dot pulse live-dot" />}{s.title}</span>
                  <span className="c">
                    {s.byCwdOnly ? 'ran here, wrote nothing' : `${s.edits} file${s.edits === 1 ? '' : 's'} written${s.primary ? '' : ', mainly elsewhere'}`} · {s.calls} calls{s.failed ? ` · ${s.failed} failed` : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {p.recordRoot ? (
            <section className="now idle">
              <div className="now-h">Record</div>
              <p className="now-p">Lessons for this repository are kept in <code>{p.recordRoot}</code>.</p>
              <div className="doc-files"><button className="btn primary" onClick={() => setTab('Learn')}>Open the lessons</button></div>
            </section>
          ) : (
            <section className="now idle">
              <div className="now-h">No record yet</div>
              <p className="now-p">This repository keeps no lessons. Open Setup in the sidebar for the two files that turn it on, then the next session writes as it builds.</p>
            </section>
          )}
        </div>
        )}
      </div>
    </>
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

function span(a: string, b: string): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'one sitting';
  const d = Math.round(ms / 86_400_000);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
  const h = Math.round(ms / 3_600_000);
  return h >= 1 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(ms / 60_000)} min`;
}
