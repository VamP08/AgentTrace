import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@agenttrace/shared';
import { fetchSessions, openSocket } from './api';
import { initial, reduce } from './store';
import { Timeline } from './views/Timeline';
import { Diffs } from './views/Diffs';
import { Agents } from './views/Agents';
import { Context } from './views/Context';
import { Setup } from './views/Setup';
import { Project, type RecordFocus } from './views/Project';
import { Story } from './views/Story';
import { Search } from './views/Search';
import type { Project as ProjectRow, ProjectIndex } from '@agenttrace/shared';
import { StackStrip } from './components/StackStrip';
import { PlainContext, readPlain, savePlain } from './reader';

// Only views that exist. Others arrive when they are built, not before. Story is first and is
// where a session opens: somebody arriving at a session they did not watch wants what changed and
// why before they want the turn-by-turn. It is the M10 digest, drawn as the session's story.
const ALL_VIEWS = [{ id: 'Story' }, { id: 'Turns' }, { id: 'Files' }, { id: 'Helpers' }, { id: 'Context' }] as const;
// M12 measures whether the digest helps, so the same app must be able to run without it:
// `?study=without` hides the Story view and sessions open on Turns, as they did before M10.
const WITHOUT_DIGEST = new URLSearchParams(location.search).get('study') === 'without';
const VIEWS = ALL_VIEWS.filter((v) => !(WITHOUT_DIGEST && v.id === 'Story'));
/** Where the second crumb's sessions come from: a project, or one of the two groups that have no repository. */
type Scope = { kind: 'project'; id: string } | { kind: 'misc' } | { kind: 'bots' };
type ViewId = (typeof ALL_VIEWS)[number]['id'];

function readTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('agenttrace-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // storage unavailable: dark by default
  }
  return 'dark';
}

export function App() {
  const [s, dispatch] = useReducer(reduce, initial);
  const [view, setView] = useState<ViewId>(WITHOUT_DIGEST ? 'Turns' : 'Story');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [plainView, setPlainView] = useState(readPlain);
  const [setup, setSetup] = useState(false);
  const [searching, setSearching] = useState(false);
  const [index, setIndex] = useState<ProjectIndex>({ projects: [], misc: [] });
  const [openProject, setOpenProject] = useState<string>();
  const [scope, setScope] = useState<Scope>();
  const [hooks, setHooks] = useState<any>();
  const [commits, setCommits] = useState<any[]>([]);
  // Three states, not two: before the first open nothing is wrong yet, and saying "offline" then
  // is a lie the reader has no way to check.
  const [link, setLink] = useState<'connecting' | 'open' | 'offline'>('connecting');
  const socket = useRef<ReturnType<typeof openSocket>>();
  // when the socket drops, the figures on screen are whatever arrived at this moment
  const lastSeen = useRef<Date>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('agenttrace-theme', theme);
    } catch {
      // fine
    }
  }, [theme]);

  useEffect(() => {
    const load = () => fetchSessions().then((sessions) => dispatch({ type: 'sessions', sessions })).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    socket.current = openSocket(
      (msg) => {
        lastSeen.current = new Date();
        dispatch({ type: 'server', msg });
      },
      (open) => {
        // onState only fires on a real open or a real close, so nothing has failed until it does
        setLink(open ? 'open' : 'offline');
        dispatch({ type: 'socket', open });
      },
    );
    return () => {
      clearInterval(t);
      socket.current?.close();
    };
  }, []);

  // The project index is built from every transcript, so it is fetched on a slow timer, and again
  // when a session appears: a session started after the page loaded belongs to no project until the
  // index has seen it, and showed as "No repository" for up to a minute.
  useEffect(() => {
    const load = () => fetch('/api/projects').then((r) => (r.ok ? r.json() : { projects: [], misc: [] })).then(setIndex).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [s.sessions.length]);

  // Which project owns each record, as record name to record folder. A search hit or a digest note
  // names its record ("HRMS"); the project list knows each project's record folder. Matching the two
  // folders is what lets a click open the lesson in the right project instead of searching again.
  const [recordRoots, setRecordRoots] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<RecordFocus>();
  useEffect(() => {
    fetch('/api/search?q=').then((r) => (r.ok ? r.json() : null)).then((x) => x?.indexed?.roots && setRecordRoots(x.indexed.roots)).catch(() => {});
  }, [index]);

  /** Open one entry of a record — a lesson, a decision, a gap, a milestone — where it lives. False when no project owns it. */
  const openRecord = (project: string, kind: string, id: string): boolean => {
    const norm = (p?: string) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const root = norm(recordRoots[project]);
    // the shared library belongs to no project; any project that keeps a record can show it
    const p = root ? index.projects.find((x) => norm(x.recordRoot) === root) : index.projects.find((x) => x.recordRoot && !x.recordMissing);
    if (!p) return false;
    setSearching(false);
    setSetup(false);
    setOpenProject(p.id);
    setScope({ kind: 'project', id: p.id });
    setFocus({ kind, id, n: Date.now() });
    return true;
  };

  const [searchQ, setSearchQ] = useState('');
  const openSearch = (q = '') => {
    setSearchQ(q);
    setSearching(true);
    setSetup(false);
  };
  /** Back to the start: no session, no project, no panel. */
  const goHome = () => {
    setSearching(false);
    setSetup(false);
    setOpenProject(undefined);
    setScope(undefined);
    dispatch({ type: 'select', id: '' });
  };

  const select = (id: string) => {
    setOpenProject(undefined);
    setSetup(false);
    setSearching(false);
    // the crumbs follow the session: the project it mainly worked in, else the group it belongs to
    const owner = index.projects.find((p) => p.sessions.some((l) => l.sessionId === id && l.primary)) ?? index.projects.find((p) => p.sessions.some((l) => l.sessionId === id));
    const x = s.sessions.find((y) => y.id === id);
    setScope(owner ? { kind: 'project', id: owner.id } : x?.automated ? { kind: 'bots' } : { kind: 'misc' });
    dispatch({ type: 'select', id });
    socket.current?.subscribe(id);
  };

  const selectProject = (id: string) => {
    setFocus(undefined);
    setSetup(false);
    setSearching(false);
    setOpenProject(id);
    setScope({ kind: 'project', id });
    dispatch({ type: 'select', id: '' });
  };
  /** A group with no repository has no page of its own; the start page lists its sessions. */
  const selectGroup = (kind: 'misc' | 'bots') => {
    goHome();
    setScope({ kind });
  };

  const current = s.sessions.find((x) => x.id === s.selected);

  // Side sources joined by id and time: the hook log (durations) and git (commits). Refetched
  // every ten live batches for the selected session; both are small.
  const tick = Math.floor(s.batches / 10);
  useEffect(() => {
    if (!s.selected) return;
    const id = s.selected;
    fetch(`/api/sessions/${id}/hooks`).then((r) => (r.ok ? r.json() : null)).then((h) => setHooks(h && h.present === false ? null : h)).catch(() => setHooks(null));
    fetch(`/api/sessions/${id}/commits`).then((r) => (r.ok ? r.json() : [])).then(setCommits).catch(() => setCommits([]));
  }, [s.selected, tick]);

  // The first crumb lists projects, one per repository. Scratchpads and the tool's own folders are
  // real places work happened, so they are kept, under "No repository".
  // Four sections: GitHub repositories, repositories not on GitHub yet, sessions that touched no
  // repository at all, and sessions a program started; the last two grouped by the folder they ran in.
  const { github, local, misc, automated } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ProjectRow) => !q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q);
    const list = index.projects.filter(match);
    const byId = new Map(s.sessions.map((x) => [x.id, x]));
    // Sessions a program started through the SDK are kept apart from the person's own: on one
    // machine they were 2,720 of 2,800, and mixed in they buried everything a person actually did.
    const groups = new Map<string, Session[]>();
    const bots = new Map<string, Session[]>();
    for (const m of index.misc) {
      const x = byId.get(m.sessionId);
      if (!x) continue;
      const into = x.automated ? bots : groups;
      into.set(m.folder, [...(into.get(m.folder) ?? []), x]);
    }
    const byRecent = (g: Map<string, Session[]>) =>
      [...g.entries()].map(([folder, items]) => ({ folder, items: items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) })).sort((a, b) => (a.items[0].updatedAt < b.items[0].updatedAt ? 1 : -1));
    return {
      github: list.filter((p) => p.kind === 'github'),
      local: list.filter((p) => p.kind === 'local'),
      misc: byRecent(groups),
      automated: byRecent(bots),
    };
  }, [index, s.sessions, query]);

  const sessionsOf = useMemo(() => {
    const byId = new Map(s.sessions.map((x) => [x.id, x]));
    return (p: ProjectRow) => p.sessions.map((l) => ({ link: l, session: byId.get(l.sessionId) })).filter((x): x is { link: ProjectRow['sessions'][number]; session: Session } => !!x.session);
  }, [s.sessions]);

  const totals = useMemo(() => {
    let calls = 0, failed = 0, turns = 0;
    for (const e of s.events) {
      if (e.kind === 'user') turns++;
      if (e.kind === 'tool_call') calls++;
      if (e.kind === 'tool_result' && e.isError) failed++;
    }
    return { calls, failed, turns };
  }, [s.events]);

  // What the second crumb offers: the sessions of whatever the first crumb names.
  const scopeProject = scope?.kind === 'project' ? index.projects.find((p) => p.id === scope.id) : undefined;
  const scopeName = scopeProject ? scopeProject.name : scope?.kind === 'misc' ? 'No repository' : scope?.kind === 'bots' ? 'Started by programs' : 'All projects';
  // Newest first, always: a list of sessions is read to find the recent one.
  const scopeSessions: MenuSession[] = useMemo(() => {
    const g = scope?.kind === 'misc' ? misc : scope?.kind === 'bots' ? automated : [];
    const list = scopeProject
      ? sessionsOf(scopeProject).map(({ link, session }) => ({ session, note: link.byCwdOnly ? 'no files here' : `${link.edits} file${link.edits === 1 ? '' : 's'}${link.primary ? '' : ', mainly elsewhere'}` }))
      : g.flatMap((x) => x.items.map((session) => ({ session, note: x.folder })));
    return list.sort((a, b) => (a.session.updatedAt < b.session.updatedAt ? 1 : -1));
  }, [scopeProject, scope, misc, automated, sessionsOf]);

  // Nothing has been found at all: the main pane owns that news.
  const nothing = index.projects.length === 0 && index.misc.length === 0 && s.sessions.length === 0;

  return (
    <PlainContext.Provider value={plainView}>
    <div className="app">
      <a className="skip" href="#main">Skip to the content</a>
      <header className="topbar">
        <div className="bar-1">
          <button className="brand" onClick={goHome} title="Back to the start"><img src="/favicon.svg" alt="" width={24} height={24} />AgentTrace</button>
          <nav className="crumbs" aria-label="Where you are">
            <Menu label={scopeName} title="Choose a project">
              {(close) => (
                <>
                  <input
                    className="dd-filter"
                    type="search"
                    autoFocus
                    placeholder="Filter projects"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Filter projects"
                  />
                  <div className="dd-scroll">
                    {index.projects.length === 0 && s.sessions.length > 0 && <p className="dd-note">Building the project index…</p>}
                    {github.length > 0 && <h3 className="dd-h">GitHub repositories <span>{github.length}</span></h3>}
                    {github.map((p) => <ProjectItem key={p.id} p={p} on={openProject === p.id || scopeProject?.id === p.id} onPick={() => { selectProject(p.id); close(); }} />)}
                    {local.length > 0 && <h3 className="dd-h">Not on GitHub yet <span>{local.length}</span></h3>}
                    {local.map((p) => <ProjectItem key={p.id} p={p} on={openProject === p.id || scopeProject?.id === p.id} onPick={() => { selectProject(p.id); close(); }} />)}
                    {(misc.length > 0 || automated.length > 0) && <h3 className="dd-h">Without a repository</h3>}
                    {misc.length > 0 && (
                      <button className={`dd-item ${scope?.kind === 'misc' ? 'on' : ''}`} onClick={() => { selectGroup('misc'); close(); }}>
                        <span className="t">No repository</span>
                        <span className="m">{count(misc)} sessions in {misc.length} folders</span>
                      </button>
                    )}
                    {automated.length > 0 && (
                      <button className={`dd-item ${scope?.kind === 'bots' ? 'on' : ''}`} onClick={() => { selectGroup('bots'); close(); }} title="Sessions a program launched through the Agent SDK, not ones you ran yourself">
                        <span className="t">Started by programs</span>
                        <span className="m">{count(automated)} sessions</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </Menu>
            {scope && (
              <>
                <span className="sep" aria-hidden>/</span>
                <Menu label={current ? current.title : 'Choose a session'} title={current?.title}>
                  {(close) => <SessionList items={scopeSessions} selected={s.selected} onPick={(id) => { select(id); close(); }} />}
                </Menu>
              </>
            )}
          </nav>
          <label className="bar-search">
            {/* Search spans every project's record, so it lives in the bar, not inside one project. */}
            {/* While Search is open its own box is the one to type in; leaving Search brings this back empty. */}
            {!searching && <input type="search" placeholder="Search the record" aria-label="Search the record" onKeyDown={(e) => { const v = e.currentTarget.value.trim(); if (e.key === 'Enter' && v) openSearch(v); }} />}
          </label>
          <div className="bar-end">
            {link === 'connecting' ? (
              <span className="conn">Connecting…</span>
            ) : link === 'open' ? (
              <span className="conn">{import.meta.env.VITE_DEMO === '1' ? 'Preview' : 'Connected'}</span>
            ) : (
              <span className="conn off" role="status" title={lastSeen.current ? `Showing the last data received at ${clock(lastSeen.current)}.` : 'No data has been received yet.'}>Server offline</span>
            )}
            <button
              className={`btn quiet ${plainView ? 'on' : ''}`}
              onClick={() => { savePlain(!plainView); setPlainView(!plainView); }}
              aria-pressed={plainView}
              title={plainView ? 'Showing tool inputs as plain fields. Turn off to see the raw JSON and raw records.' : 'Showing raw JSON. Turn on for plain fields.'}
            >
              Plain view
            </button>
            <button className="btn quiet" onClick={() => { setSetup(true); setSearching(false); }}>Setup</button>
            <button className="btn quiet" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'}>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
        {current && !searching && !setup && !openProject && (
          <div className="bar-2">
            <div className="tabs" role="tablist">
              {VIEWS.map((v) => (
                <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
                  {v.id}
                  {v.id === 'Turns' && !s.loading && <small>{totals.turns}</small>}
                  {v.id === 'Helpers' && s.agents.length > 0 && <small>{s.agents.length}</small>}
                </button>
              ))}
            </div>
            <div className="bar-state">
              <span className="when">{span(current.startedAt, current.updatedAt)}</span>
              {current.live ? <span className="pill live"><i className="dot pulse" />Live</span> : current.archived ? <span className="pill">Archived copy</span> : null}
              {totals.failed > 0 && <span className="pill fail">{totals.failed} failed</span>}
            </div>
            <div id="view-tools" className="tools" />
          </div>
        )}
      </header>

      <main className="main" id="main" tabIndex={-1}>
        {searching ? (
          <Search key={searchQ} initial={searchQ} onOpenSession={select} onOpenRecord={openRecord} onClose={() => setSearching(false)} />
        ) : setup ? (
          <Setup onClose={() => setSetup(false)} />
        ) : openProject ? (
          <Project id={openProject} focus={focus} onOpenSession={select} onOpenProject={selectProject} />
        ) : nothing ? (
          <div className="firstrun">
            <h2>No transcripts found.</h2>
            <p>The server reads <code>~/.claude/projects</code>. Nothing readable is there yet, so there is nothing to show.</p>
            <p>Set <code>CLAUDE_CONFIG_DIR</code> if your transcripts live somewhere else, then reload.</p>
          </div>
        ) : !current ? (
          <Home
            sessions={s.sessions}
            projects={[...index.projects].sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1)).slice(0, 10).map((p) => ({ id: p.id, name: p.name, live: !!p.live, lastTs: p.lastTs, sessions: sessionsOf(p).map((x) => x.session) }))}
            group={scope?.kind === 'misc' ? { label: 'No repository', items: scopeSessions } : scope?.kind === 'bots' ? { label: 'Started by programs', items: scopeSessions } : undefined}
            onOpenSession={select}
            onOpenProject={selectProject}
          />
        ) : (
          <div className="stage">
            <StackStrip events={s.events} />
            {view === 'Story' && <Story sessionId={current.id} session={current} events={s.events} live={current.live} batches={s.batches} agents={s.agents.length} onOpenRecord={openRecord} onView={(v) => setView(v)} />}
            {view === 'Turns' && <Timeline events={s.events} agents={s.agents} loading={s.loading} parseErrors={s.parseErrors} batches={s.batches} live={current.live} durations={hooks?.durations} commits={commits} sessionId={current.id} />}
            {view === 'Context' && <Context events={s.events} hooks={hooks} />}
            {view === 'Files' && <Diffs sessionId={current.id} events={s.events} cwd={current.cwd} />}
            {view === 'Helpers' && (
              <Agents
                sessionId={current.id}
                events={s.events}
                agents={s.agents}
                agentEvents={s.agentEvents}
                live={current.live}
                onLoadAgent={(agentId, events) => dispatch({ type: 'agentHistory', agentId, events })}
              />
            )}
          </div>
        )}
      </main>
    </div>
    </PlainContext.Provider>
  );
}

function count(groups: { items: unknown[] }[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}
function span(from: string, to: string): string {
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(a.getTime())) return '';
  const day = a.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const t = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return Number.isNaN(b.getTime()) || a.toDateString() !== b.toDateString() ? `${day}, ${t(a)}` : `${day}, ${t(a)} to ${t(b)}`;
}

function project(x: Session): string {
  const tail = x.cwd.split(/[\\/]/).filter(Boolean).pop();
  return tail || x.projectSlug;
}
function mb(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
}
function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * The start page: what is live and what happened since the last visit. With a group picked in the
 * first crumb (no repository, or started by programs), it lists that group's sessions instead,
 * since those groups have no page of their own. Sessions a program started are otherwise left out.
 */
function Home({ sessions, projects, group, onOpenSession, onOpenProject }: {
  sessions: Session[];
  projects: { id: string; name: string; live: boolean; lastTs: string; sessions: Session[] }[];
  group?: { label: string; items: MenuSession[] };
  onOpenSession: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  // the previous visit, read once; this visit is written for next time
  const [since] = useState(() => {
    try {
      const v = localStorage.getItem('agenttrace-last-visit');
      localStorage.setItem('agenttrace-last-visit', new Date().toISOString());
      return v ?? '';
    } catch {
      return '';
    }
  });
  if (group) {
    return (
      <div className="scroll">
        <div className="page">
          <h1 className="page-title">{group.label}</h1>
          <p className="page-lede">{group.items.length} sessions that wrote into no repository, newest first.</p>
          <SessionList items={group.items} onPick={onOpenSession} />
        </div>
      </div>
    );
  }
  const mine = sessions.filter((x) => !x.automated).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const live = mine.filter((x) => x.live);
  // the one to pick up: a running session if there is one, else the last one touched
  const resume = live[0] ?? mine[0];
  const recent = mine.filter((x) => x !== resume).slice(0, 8);
  const fresh = since ? mine.filter((x) => x.updatedAt > since).length : 0;
  const days = lastDays(DAYS);
  const perDay = days.map((d) => mine.filter((x) => dayKey(x.startedAt) === d || dayKey(x.updatedAt) === d).length);
  const most = Math.max(1, ...perDay);
  const worked = perDay.filter(Boolean).length;
  return (
    <div className="scroll">
      <div className="home">
        <header>
          <h1 className="page-title">{live.length > 0 ? `${live.length} session${live.length === 1 ? '' : 's'} running now` : 'Nothing is running now'}</h1>
          <p className="page-lede">
            {fresh > 0 ? `${fresh} session${fresh === 1 ? '' : 's'} changed since your last visit. ` : ''}
            {worked > 0 ? `You worked on ${worked} of the last ${DAYS} days.` : `Nothing in the last ${DAYS} days.`}
          </p>
        </header>
        <div className="home-cols">
          <div>
            {resume && (
              <section className="sec">
                <h2>{resume.live ? 'Running now' : 'Pick up where you left off'}</h2>
                <button className="resume" onClick={() => onOpenSession(resume.id)}>
                  <span className="resume-t">{resume.title}</span>
                  <span className="resume-m">
                    {resume.live && <i className="dot pulse live-dot" />}{project(resume)} · {resume.live ? 'running' : ago(resume.updatedAt)} · ran {length(resume.startedAt, resume.updatedAt)} · {mb(resume.bytes)}
                  </span>
                  <span className="resume-go">Open its story</span>
                </button>
              </section>
            )}
            <section className="sec">
              <h2>Your last {DAYS} days</h2>
              <div className="days" role="img" aria-label={`Sessions per day over the last ${DAYS} days: ${perDay.join(', ')}`}>
                {days.map((d, i) => (
                  <div key={d} className="day" title={`${dayLabel(d)}: ${perDay[i]} session${perDay[i] === 1 ? '' : 's'}`}>
                    <i style={{ height: `${perDay[i] ? 12 + (perDay[i] / most) * 88 : 0}%` }} className={`h${perDay[i] ? Math.min(4, Math.ceil((perDay[i] / most) * 4)) : 0}`} />
                    <span>{i === 0 || i === days.length - 1 || new Date(d).getDay() === 1 ? dayLabel(d) : ''}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="sec">
              <h2>Latest</h2>
              {recent.length === 0 ? <p className="page-lede">No other sessions yet.</p> : <SessionList items={recent.map((session) => ({ session, note: project(session), fresh: !!since && session.updatedAt > since }))} onPick={onOpenSession} />}
            </section>
          </div>
          <aside>
            <section className="sec">
              <h2>Projects</h2>
              {projects.length === 0 && <p className="page-lede">Building the project index…</p>}
              <ul className="projs">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => onOpenProject(p.id)}>
                      <span className="t">{p.live && <i className="dot pulse live-dot" />}{p.name}</span>
                      <span className="marks" aria-hidden>
                        {days.map((d) => <i key={d} className={p.sessions.some((x) => dayKey(x.updatedAt) === d || dayKey(x.startedAt) === d) ? 'on' : ''} />)}
                      </span>
                      <span className="m">{p.sessions.length} session{p.sessions.length === 1 ? '' : 's'} · {ago(p.lastTs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Days shown on the start page's activity strip and each project's marks. */
const DAYS = 14;
function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * 86400000).toISOString()));
  return out;
}
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
function length(from: string, to: string): string {
  const m = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  if (!Number.isFinite(m)) return '';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

interface MenuSession {
  session: Session;
  note: string;
  fresh?: boolean;
}

/** A dropdown that closes on a click outside it, on Escape, and after a choice. */
function Menu({ label, title, children }: { label: string; title?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // Closed from the keyboard or by a choice, focus goes back to the menu's own button; left inside
  // the menu it fell to the page body, and the next Tab started from the top of the page.
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button ref={btn} className="dd-btn" aria-expanded={open} aria-haspopup="true" title={title} onClick={() => setOpen(!open)}>
        <span>{label}</span>
      </button>
      {open && <div className="dd-menu">{children(close)}</div>}
    </div>
  );
}

function ProjectItem({ p, on, onPick }: { p: ProjectRow; on: boolean; onPick: () => void }) {
  return (
    <button className={`dd-item ${on ? 'on' : ''}`} onClick={onPick} title={p.root}>
      <span className="t">{p.live && <i className="dot pulse live-dot" />}{p.name}</span>
      <span className="m">{p.sessions.length} session{p.sessions.length === 1 ? '' : 's'} · {ago(p.lastTs)}</span>
    </button>
  );
}

/** Sessions, newest first, with a filter once there are enough to need one. Long groups show the first 200. */
function SessionList({ items, selected, onPick }: { items: MenuSession[]; selected?: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter((x) => x.session.title.toLowerCase().includes(t) || x.note.toLowerCase().includes(t)) : items).slice(0, 200);
  }, [items, q]);
  return (
    <div className="slist">
      {items.length > 8 && <input className="dd-filter" type="search" placeholder={`Filter ${items.length} sessions`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter sessions" />}
      <div className="dd-scroll">
        {shown.length === 0 && <p className="dd-note">No session matches.</p>}
        {shown.map(({ session: x, note, fresh }) => (
          <button key={x.id} className={`dd-item ${x.id === selected ? 'on' : ''}`} onClick={() => onPick(x.id)} aria-current={x.id === selected ? 'true' : undefined}>
            <span className="t">{x.live && <i className="dot pulse live-dot" />}{x.title}</span>
            <span className="m">{fresh && <b>new · </b>}{ago(x.updatedAt)} · {note} · {mb(x.bytes)}</span>
          </button>
        ))}
        {shown.length === 200 && <p className="dd-note">Showing the newest 200. Filter to find an older one.</p>}
      </div>
    </div>
  );
}
