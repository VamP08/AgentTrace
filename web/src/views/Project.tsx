// A project is one repository. Its page merges every turn that edited it, from any session,
// so work split across two sittings, or a sitting split across two repositories, still reads whole.
import { useEffect, useMemo, useState } from 'react';
import type { ProjectDetail, TurnRef } from '@agenttrace/shared';

interface Props {
  root: string;
  onOpenSession: (sessionId: string) => void;
  onOpenProject: (root: string) => void;
}

type Tab = 'Overview' | 'Turns' | 'Sessions';

export function Project({ root, onOpenSession, onOpenProject }: Props) {
  const [p, setP] = useState<ProjectDetail | null | undefined>();
  const [tab, setTab] = useState<Tab>('Overview');

  useEffect(() => {
    setP(undefined);
    setTab('Overview');
    fetch(`/api/projects/${btoa(root).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setP)
      .catch(() => setP(null));
  }, [root]);

  const days = useMemo(() => {
    if (!p) return [];
    const m = new Map<string, TurnRef[]>();
    for (const t of p.turnList) {
      const d = t.startTs.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return [...m.entries()];
  }, [p]);

  if (p === undefined) return <div className="empty" aria-busy="true">Reading every session for this project…</div>;
  if (p === null) return <div className="empty">This project is no longer in the index. Reopen it from the sidebar.</div>;

  return (
    <>
      <header className="head">
        <div className="row1">
          <h2 title={p.root}>{p.name}</h2>
          <span className={`pill ${p.live ? 'live' : ''}`}>{p.live ? 'Live' : 'Idle'}</span>
          <span className="pill">{p.kind === 'repo' ? 'repository' : p.kind === 'folder' ? 'folder' : p.kind}</span>
        </div>
        <div className="meta">
          <span>Path <b title={p.root}>{p.root}</b></span>
          {p.remote && <span>Remote <b>{p.remote.replace(/^https?:\/\//, '').replace(/\.git$/, '')}</b></span>}
          <span>Turns <b>{p.turns}</b></span>
          <span>Sessions <b>{p.sessions.length}</b></span>
          <span>Tool calls <b>{p.calls}</b></span>
          {p.failed > 0 && <span>Failed <b>{p.failed}</b></span>}
        </div>
        <div className="row2">
          <div className="seg" role="tablist">
            {(['Overview', 'Turns', 'Sessions'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="stage">
        {tab === 'Overview' && (
          <div className="scroll">
            <section className="now idle">
              <div className="now-h">What this project is</div>
              <p className="now-p">
                Everything below was gathered from {p.sessions.length} session{p.sessions.length === 1 ? '' : 's'} that edited
                files inside <code>{p.root}</code>. A sitting that worked on two projects appears in both, and its turns are
                counted where the edits landed, so nothing is attributed to the wrong place.
              </p>
              <div className="now-grid">
                <Stat n={p.turns} label="turns" />
                <Stat n={p.sessions.length} label="sessions" />
                <Stat n={p.calls} label="tool calls" />
                <Stat n={p.failed} label="failed" tone={p.failed ? 'fail' : undefined} />
                <Stat n={span(p.firstTs, p.lastTs)} label="from first to last" />
              </div>
            </section>
            <section className="now idle">
              <div className="now-h">Worked on</div>
              <div className="ctx-table">
                {days.slice(0, 14).map(([d, list]) => (
                  <div className="ctx-line day" key={d}>
                    <span className="n">{d}</span>
                    <span className="p">{list[0].prompt}</span>
                    <span className="c">{list.length} turn{list.length === 1 ? '' : 's'}</span>
                  </div>
                ))}
                {days.length > 14 && <div className="empty small">{days.length - 14} earlier day{days.length - 14 === 1 ? '' : 's'} in the Turns tab.</div>}
              </div>
            </section>
            {p.recordRoot ? (
              <section className="now idle">
                <div className="now-h">Record</div>
                <p className="now-p">Lessons for this project are kept in <code>{p.recordRoot}</code>. Open any of its sessions and choose Learn.</p>
              </section>
            ) : (
              <section className="now idle">
                <div className="now-h">No record yet</div>
                <p className="now-p">This project keeps no lessons. Open Setup in the sidebar for the two files that turn it on, then the next session writes as it builds.</p>
              </section>
            )}
          </div>
        )}

        {tab === 'Turns' && (
          <div className="scroll">
            {p.turnList.map((t) => (
              <button className="chapter" key={`${t.sessionId}:${t.n}`} onClick={() => onOpenSession(t.sessionId)}>
                <span className="n">{t.n}</span>
                <span className="p">{t.prompt}</span>
                <span className="c">{t.edits[p.root]} edit{t.edits[p.root] === 1 ? '' : 's'}</span>
                <span className="c">{t.calls} calls</span>
                {t.failed > 0 && <span className="c fail">{t.failed} failed</span>}
                {t.also.length > 0 && (
                  <span className="c also" title={t.also.join(', ')}>
                    also {t.also.map((r) => r.split(/[\\/]/).pop()).join(', ')}
                  </span>
                )}
                <span className="c time">{t.startTs.slice(0, 16).replace('T', ' ')}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'Sessions' && (
          <div className="scroll">
            {p.sessionList.map((s) => (
              <button className="chapter" key={s.id} onClick={() => onOpenSession(s.id)}>
                <span className="p">{s.title}</span>
                <span className="c">{s.turns} turn{s.turns === 1 ? '' : 's'} here</span>
                {s.live && <span className="c state live">Live</span>}
                <span className="c time">{s.updatedAt.slice(0, 16).replace('T', ' ')}</span>
              </button>
            ))}
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
