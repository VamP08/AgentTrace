import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Session } from '@agenttrace/shared';
import { fetchSessions, openSocket } from './api';
import { initial, reduce } from './store';
import { Timeline } from './views/Timeline';
import { Diffs } from './views/Diffs';
import { Agents } from './views/Agents';
import { Context } from './views/Context';
import { Setup } from './views/Setup';
import { Project, type RecordFocus } from './views/Project';
import { Digest } from './views/Digest';
import { Search } from './views/Search';
import type { Project as ProjectRow, ProjectIndex } from '@agenttrace/shared';
import { StackStrip } from './components/StackStrip';

// Only views that exist. Others arrive when they are built, not before. Digest is first and is
// where a session opens: somebody arriving at a session they did not watch wants what changed and
// why before they want the turn-by-turn.
const VIEWS = [{ id: 'Digest' }, { id: 'Turns' }, { id: 'Files' }, { id: 'Helpers' }, { id: 'Context' }] as const;
type ViewId = (typeof VIEWS)[number]['id'];

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
  const [view, setView] = useState<ViewId>('Digest');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [setup, setSetup] = useState(false);
  const [searching, setSearching] = useState(false);
  const [index, setIndex] = useState<ProjectIndex>({ projects: [], misc: [] });
  const [openProject, setOpenProject] = useState<string>();
  const [showOther, setShowOther] = useState(false);
  const [showBots, setShowBots] = useState(false);
  const [hooks, setHooks] = useState<any>();
  const [commits, setCommits] = useState<any[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  // Three states, not two: before the first open nothing is wrong yet, and saying "offline" then
  // is a lie the reader has no way to check.
  const [link, setLink] = useState<'connecting' | 'open' | 'offline'>('connecting');
  const socket = useRef<ReturnType<typeof openSocket>>();
  const railClose = useRef<HTMLButtonElement>(null);
  // when the socket drops, the figures on screen are whatever arrived at this moment
  const lastSeen = useRef<Date>();

  // Under 900px the rail is an overlay. Opening it moves focus inside; Escape closes it.
  useEffect(() => {
    if (!railOpen) return;
    railClose.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

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

  // The project index is built from every transcript, so it is fetched once and on a slow timer.
  useEffect(() => {
    const load = () => fetch('/api/projects').then((r) => (r.ok ? r.json() : { projects: [], misc: [] })).then(setIndex).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

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
    setRailOpen(false);
    setOpenProject(p.id);
    setOpened((o) => ({ ...o, [p.id]: true }));
    setFocus({ kind, id, n: Date.now() });
    return true;
  };

  const [searchQ, setSearchQ] = useState('');
  const openSearch = (q = '') => {
    setSearchQ(q);
    setSearching(true);
    setSetup(false);
    setRailOpen(false);
  };
  /** Back to the start: no session, no project, no panel. */
  const goHome = () => {
    setSearching(false);
    setSetup(false);
    setOpenProject(undefined);
    setRailOpen(false);
    dispatch({ type: 'select', id: '' });
  };

  const select = (id: string) => {
    setOpenProject(undefined);
    setSetup(false);
    setSearching(false);
    setRailOpen(false);
    dispatch({ type: 'select', id });
    socket.current?.subscribe(id);
  };

  const selectProject = (id: string) => {
    setFocus(undefined);
    setSetup(false);
    setSearching(false);
    setRailOpen(false);
    setOpenProject(id);
    setOpened((o) => ({ ...o, [id]: true }));
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

  // The sidebar lists projects, one per repository. Scratchpads and the tool's own folders are
  // real places work happened, so they are kept, but folded away under "Other places".
  // Three sections: GitHub repositories, repositories not on GitHub yet, and sessions that touched
  // no repository at all, grouped by the folder they ran in.
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
      if (q && !x.title.toLowerCase().includes(q) && !m.folder.toLowerCase().includes(q)) continue;
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
  const people = useMemo(() => s.sessions.filter((x) => !x.automated).length, [s.sessions]);

  const sessionsOf = useMemo(() => {
    const byId = new Map(s.sessions.map((x) => [x.id, x]));
    return (p: ProjectRow) => p.sessions.map((l) => ({ link: l, session: byId.get(l.sessionId) })).filter((x): x is { link: ProjectRow['sessions'][number]; session: Session } => !!x.session);
  }, [s.sessions]);

  const totals = useMemo(() => {
    let output = 0, cacheRead = 0, calls = 0, failed = 0;
    const results = new Set<string>();
    for (const e of s.events) {
      if (e.kind === 'usage') { output += e.output; cacheRead += e.cacheRead; }
      if (e.kind === 'tool_call') calls++;
      if (e.kind === 'tool_result') { results.add(e.toolUseId); if (e.isError) failed++; }
    }
    return { output, cacheRead, calls, failed };
  }, [s.events]);

  // Nothing has been found at all: the main pane owns that news, not a line in the rail.
  const nothing = index.projects.length === 0 && index.misc.length === 0 && s.sessions.length === 0;

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the session</a>
      {railOpen && <button className="scrim" aria-label="Close the session list" onClick={() => setRailOpen(false)} />}
      <aside className={`side ${railOpen ? 'open' : ''}`} aria-label="Sessions">
        <div className="brand">
          <span className="mark" aria-hidden />
          <h1><button className="home-link" onClick={goHome} title="Back to the start">AgentTrace</button></h1>
          <span className="sub" title={people < s.sessions.length ? `and ${s.sessions.length - people} started by programs` : undefined}>{people} sessions</span>
          <button className="btn sm quiet close" ref={railClose} onClick={() => setRailOpen(false)}>Close</button>
        </div>
        <div className="search">
          {/* One box: typing filters the projects below, Enter searches every record. Search used to be
              a quiet link in the footer, though it is the one tool that spans every project. */}
          <input
            type="search"
            placeholder="Filter, or Enter to search the record"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query.trim() && openSearch(query.trim())}
            aria-label="Filter projects, or press Enter to search the record"
          />
        </div>
        <nav className="list">
          {index.projects.length === 0 && index.misc.length === 0 && s.sessions.length > 0 && <div className="empty small">Building the project index…</div>}
          {github.length > 0 && <div className="ghead static">GitHub repositories<span className="n">{github.length}</span></div>}
          {github.map((p) => (
            <ProjectGroup key={p.id} p={p} open={!!opened[p.id]} sessions={sessionsOf(p)} selectedProject={openProject} selectedSession={s.selected} onToggle={() => setOpened({ ...opened, [p.id]: !opened[p.id] })} onProject={selectProject} onSession={select} />
          ))}
          {local.length > 0 && <div className="ghead static">Not on GitHub yet<span className="n">{local.length}</span></div>}
          {local.map((p) => (
            <ProjectGroup key={p.id} p={p} open={!!opened[p.id]} sessions={sessionsOf(p)} selectedProject={openProject} selectedSession={s.selected} onToggle={() => setOpened({ ...opened, [p.id]: !opened[p.id] })} onProject={selectProject} onSession={select} />
          ))}
          {misc.length > 0 && <MiscGroup label="No repository" groups={misc} open={showOther} onToggle={() => setShowOther(!showOther)} selected={s.selected} onSession={select} />}
          {automated.length > 0 && (
            <MiscGroup
              label="Started by programs"
              title="Sessions a program launched through the Agent SDK, not ones you ran yourself"
              groups={automated}
              open={showBots}
              onToggle={() => setShowBots(!showBots)}
              selected={s.selected}
              onSession={select}
            />
          )}
        </nav>
        <div className={`foot ${link === 'offline' ? 'offline' : ''}`} role={link === 'offline' ? 'status' : undefined}>
          {link === 'connecting' ? (
            <span>Connecting…</span>
          ) : (
            <span className="state"><i className="dot" style={{ color: link === 'open' ? 'var(--success)' : 'var(--danger)' }} />{link === 'open' ? 'Server connected' : 'Server offline'}</span>
          )}
          <button className="btn sm quiet" onClick={() => { setSetup(true); setSearching(false); setRailOpen(false); }}>Setup</button>
          <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'}>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          {link === 'offline' && <span className="said">{lastSeen.current ? `Showing the last data received at ${clock(lastSeen.current)}.` : 'No data has been received yet.'}</span>}
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        <div className="railbar">
          <button className="btn quiet" onClick={() => setRailOpen(true)} aria-expanded={railOpen}>Sessions</button>
        </div>
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
          <Home sessions={s.sessions} onOpenSession={select} onSearch={openSearch} />
        ) : (
          <>
            <header className="head">
              <div className="row1">
                <h2 title={current.title}>{current.title}</h2>
                <span className={`pill ${current.live ? 'live' : ''}`}>{current.live ? 'Live' : current.archived ? 'Archived copy' : 'Idle'}</span>
                {totals.failed > 0 && <span className="pill fail">{totals.failed} failed</span>}
              </div>
              <div className="meta">
                <span>Folder <b>{project(current)}</b></span>
                <span>Started <b>{when(current.startedAt)}</b></span>
                {/* a zero here would read as "none", not as "not counted yet" */}
                <span>Tool calls <b>{s.loading ? '…' : totals.calls}</b></span>
                <span>Tokens out <b>{s.loading ? '…' : fmt(totals.output)}</b></span>
                <span>Cache read <b>{s.loading ? '…' : fmt(totals.cacheRead)}</b></span>
                <span>Transcript <b>{mb(current.bytes)}</b></span>
              </div>
              <div className="row2">
                <div className="seg" role="tablist">
                  {VIEWS.map((v) => (
                    <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
                      {v.id}
                    </button>
                  ))}
                </div>
                <div id="view-tools" className="tools" />
              </div>
            </header>
            <div className="stage">
              <StackStrip events={s.events} />
              {view === 'Digest' && <Digest sessionId={current.id} live={current.live} batches={s.batches} onOpenRecord={openRecord} />}
              {view === 'Turns' && <Timeline events={s.events} agents={s.agents} loading={s.loading} parseErrors={s.parseErrors} batches={s.batches} live={current.live} durations={hooks?.durations} commits={commits} sessionId={current.id} />}
              {view === 'Context' && <Context events={s.events} hooks={hooks} />}
              {view === 'Files' && <Diffs sessionId={current.id} events={s.events} />}
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
          </>
        )}
      </main>
    </div>
  );
}

function project(x: Session): string {
  const tail = x.cwd.split(/[\\/]/).filter(Boolean).pop();
  return tail || x.projectSlug;
}
function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
function mb(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
}
function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
 * The start page: what is live, what happened since the last visit, and a search box. It used to be
 * "Choose a project." and a paragraph, which answered none of a returning reader's first questions.
 * Sessions a program started are left out, as they are from the counts.
 */
function Home({ sessions, onOpenSession, onSearch }: { sessions: Session[]; onOpenSession: (id: string) => void; onSearch: (q: string) => void }) {
  const [q, setQ] = useState('');
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
  const mine = sessions.filter((x) => !x.automated);
  const live = mine.filter((x) => x.live);
  const recent = mine.filter((x) => !x.live).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8);
  const fresh = since ? recent.filter((x) => x.updatedAt > since).length : 0;
  const row = (x: Session, label: string) => (
    <li key={x.id}>
      <span className="kind">{label}</span>
      <span className="t"><button className="dg-open" onClick={() => onOpenSession(x.id)}>{x.title}</button></span>
      <span className="c">{project(x)} · {ago(x.updatedAt)}</span>
    </li>
  );
  return (
    <div className="scroll">
      <section className="explainer" aria-label="Search the record">
        <h3>Search the record</h3>
        <div className="srch">
          <input type="search" value={q} placeholder="why is chokidar here" aria-label="Search the record" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && onSearch(q.trim())} />
        </div>
        <p className="now-p small">Lessons, decisions, gaps and milestones across every project. Press Enter.</p>
      </section>
      {live.length > 0 && (
        <section className="dg">
          <h3>Live now</h3>
          <ul className="dg-notes">{live.map((x) => row(x, 'live'))}</ul>
        </section>
      )}
      <section className="dg">
        <h3>Latest sessions{fresh > 0 ? ` · ${fresh} since your last visit` : ''}</h3>
        {recent.length === 0 ? <p className="now-p">No sessions yet.</p> : <ul className="dg-notes">{recent.map((x) => row(x, since && x.updatedAt > since ? 'new' : 'session'))}</ul>}
        <p className="now-p small">A project's page in the sidebar has its whole story: every session, and where its record stands.</p>
      </section>
    </div>
  );
}

/** A collapsed group of sessions that belong to no repository, grouped by the folder they ran in. */
function MiscGroup({ label, title, groups, open, onToggle, selected, onSession }: {
  label: string;
  title?: string;
  groups: { folder: string; items: Session[] }[];
  open: boolean;
  onToggle: () => void;
  selected?: string;
  onSession: (id: string) => void;
}) {
  return (
    <div className="group">
      <button className="ghead" onClick={onToggle} aria-expanded={open} title={title}>
        <span className={`chev ${open ? '' : 'closed'}`} aria-hidden />
        {label}
        <span className="n">{groups.reduce((n, g) => n + g.items.length, 0)}</span>
      </button>
      {open &&
        groups.map((g) => (
          <div className="group" key={g.folder}>
            <div className="ghead sub">{g.folder}<span className="n">{g.items.length}</span></div>
            {g.items.map((x) => (
              <button key={x.id} className={`sess ${x.id === selected ? 'sel' : ''}`} onClick={() => onSession(x.id)} aria-current={x.id === selected ? 'true' : undefined}>
                <span className="t">{x.title}</span>
                <span className="m">{x.live && <span className="live"><i className="dot pulse" />Live</span>}{ago(x.updatedAt)} · {mb(x.bytes)}</span>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

/** One project in the sidebar: its own row, and its sessions beneath when opened. */
function ProjectGroup({ p, open, sessions, selectedProject, selectedSession, onToggle, onProject, onSession }: {
  p: ProjectRow;
  open: boolean;
  sessions: { link: ProjectRow['sessions'][number]; session: Session }[];
  selectedProject?: string;
  selectedSession?: string;
  onToggle: () => void;
  onProject: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const mainly = sessions.filter((x) => x.link.primary).length;
  return (
    <div className="group project">
      <div className={`prow ${selectedProject === p.id ? 'sel' : ''}`}>
        <button className="twist" onClick={onToggle} aria-expanded={open} aria-label={open ? `Hide sessions of ${p.name}` : `Show sessions of ${p.name}`}>
          <span className={`chev ${open ? '' : 'closed'}`} aria-hidden />
        </button>
        <button className="pname" onClick={() => onProject(p.id)} title={p.root} aria-current={selectedProject === p.id ? 'true' : undefined}>
          <span className="t">{p.live && <i className="dot pulse live-dot" />}{p.name}</span>
          <span className="m">{sessions.length} session{sessions.length === 1 ? '' : 's'}{mainly !== sessions.length ? `, ${mainly} mainly` : ''} · {ago(p.lastTs)}</span>
        </button>
      </div>
      {open &&
        sessions.map(({ link, session: x }) => (
          <button key={x.id} className={`sess ${x.id === selectedSession ? 'sel' : ''} ${link.primary ? '' : 'also'}`} onClick={() => onSession(x.id)} aria-current={x.id === selectedSession ? 'true' : undefined} title={link.byCwdOnly ? 'Ran here, wrote nothing' : link.primary ? undefined : 'Mainly worked elsewhere'}>
            <span className="t">{x.title}</span>
            <span className="m">
              {x.live && <span className="live"><i className="dot pulse" />Live</span>}
              {ago(x.updatedAt)} · {link.byCwdOnly ? 'no files here' : `${link.edits} file${link.edits === 1 ? '' : 's'}`}{link.primary ? '' : ' · also'}
            </span>
          </button>
        ))}
    </div>
  );
}
