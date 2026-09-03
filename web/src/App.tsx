import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Session } from '@agenttrace/shared';
import { fetchSessions, openSocket } from './api';
import { initial, reduce } from './store';
import { Timeline } from './views/Timeline';
import { Diffs } from './views/Diffs';
import { Agents } from './views/Agents';
import { Context } from './views/Context';
import { Setup } from './views/Setup';
import { Project } from './views/Project';
import type { Project as ProjectRow, ProjectIndex } from '@agenttrace/shared';
import { StackStrip } from './components/StackStrip';

// Only views that exist. Others arrive when they are built, not before.
const VIEWS = [{ id: 'Turns' }, { id: 'Files' }, { id: 'Helpers' }, { id: 'Context' }] as const;
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
  const [view, setView] = useState<ViewId>('Turns');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [setup, setSetup] = useState(false);
  const [index, setIndex] = useState<ProjectIndex>({ projects: [], misc: [] });
  const [openProject, setOpenProject] = useState<string>();
  const [showOther, setShowOther] = useState(false);
  const [hooks, setHooks] = useState<any>();
  const [commits, setCommits] = useState<any[]>([]);
  const socket = useRef<ReturnType<typeof openSocket>>();

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
      (msg) => dispatch({ type: 'server', msg }),
      (open) => dispatch({ type: 'socket', open }),
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

  const select = (id: string) => {
    setOpenProject(undefined);
    setSetup(false);
    dispatch({ type: 'select', id });
    socket.current?.subscribe(id);
  };

  const selectProject = (id: string) => {
    setSetup(false);
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
  const { github, local, misc } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ProjectRow) => !q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q);
    const list = index.projects.filter(match);
    const byId = new Map(s.sessions.map((x) => [x.id, x]));
    const groups = new Map<string, Session[]>();
    for (const m of index.misc) {
      const x = byId.get(m.sessionId);
      if (!x) continue;
      if (q && !x.title.toLowerCase().includes(q) && !m.folder.toLowerCase().includes(q)) continue;
      groups.set(m.folder, [...(groups.get(m.folder) ?? []), x]);
    }
    return {
      github: list.filter((p) => p.kind === 'github'),
      local: list.filter((p) => p.kind === 'local'),
      misc: [...groups.entries()].map(([folder, items]) => ({ folder, items: items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) })).sort((a, b) => (a.items[0].updatedAt < b.items[0].updatedAt ? 1 : -1)),
    };
  }, [index, s.sessions, query]);

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

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the session</a>
      <aside className="side" aria-label="Sessions">
        <div className="brand">
          <span className="mark" aria-hidden />
          <h1>AgentTrace</h1>
          <span className="sub">{s.sessions.length} sessions</span>
        </div>
        <div className="search">
          <input
            type="search"
            placeholder="Filter projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter projects"
          />
        </div>
        <nav className="list">
          {index.projects.length === 0 && s.sessions.length === 0 && (
            <div className="empty small">
              No transcripts found. The server reads <code>~/.claude/projects</code>; set <code>CLAUDE_CONFIG_DIR</code> if yours lives elsewhere.
            </div>
          )}
          {index.projects.length === 0 && index.misc.length === 0 && s.sessions.length > 0 && <div className="empty small">Building the project index…</div>}
          {github.length > 0 && <div className="ghead static">GitHub repositories<span className="n">{github.length}</span></div>}
          {github.map((p) => (
            <ProjectGroup key={p.id} p={p} open={!!opened[p.id]} sessions={sessionsOf(p)} selectedProject={openProject} selectedSession={s.selected} onToggle={() => setOpened({ ...opened, [p.id]: !opened[p.id] })} onProject={selectProject} onSession={select} />
          ))}
          {local.length > 0 && <div className="ghead static">Not on GitHub yet<span className="n">{local.length}</span></div>}
          {local.map((p) => (
            <ProjectGroup key={p.id} p={p} open={!!opened[p.id]} sessions={sessionsOf(p)} selectedProject={openProject} selectedSession={s.selected} onToggle={() => setOpened({ ...opened, [p.id]: !opened[p.id] })} onProject={selectProject} onSession={select} />
          ))}
          {misc.length > 0 && (
            <div className="group">
              <button className="ghead" onClick={() => setShowOther(!showOther)} aria-expanded={showOther}>
                <span className={`chev ${showOther ? '' : 'closed'}`} aria-hidden />
                No repository
                <span className="n">{misc.reduce((n, g) => n + g.items.length, 0)}</span>
              </button>
              {showOther &&
                misc.map((g) => (
                  <div className="group" key={g.folder}>
                    <div className="ghead sub">{g.folder}<span className="n">{g.items.length}</span></div>
                    {g.items.map((x) => (
                      <button key={x.id} className={`sess ${x.id === s.selected ? 'sel' : ''}`} onClick={() => select(x.id)} aria-current={x.id === s.selected ? 'true' : undefined}>
                        <span className="t">{x.title}</span>
                        <span className="m">{x.live && <span className="live"><i className="dot pulse" />Live</span>}{ago(x.updatedAt)} · {mb(x.bytes)}</span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </nav>
        <div className="foot">
          <span><i className="dot" style={{ color: s.connected ? 'var(--ok)' : 'var(--fail)' }} />{s.connected ? 'Server connected' : 'Server offline'}</span>
          <button className="btn sm quiet" onClick={() => setSetup(true)}>Setup</button>
          <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'}>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        {setup ? (
          <Setup onClose={() => setSetup(false)} />
        ) : openProject ? (
          <Project id={openProject} onOpenSession={select} onOpenProject={selectProject} />
        ) : !current ? (
          <div className="empty">
            <h3>Choose a project.</h3>
            A project is one GitHub repository, and its page gathers every session that wrote files into it, wherever the session was started. Open a project for the whole story, or one of its sessions for a single sitting.
          </div>
        ) : (
          <>
            <header className="head">
              <div className="row1">
                <h2 title={current.title}>{current.title}</h2>
                <span className={`pill ${current.live ? 'live' : ''}`}>{current.live ? 'Live' : 'Idle'}</span>
                {totals.failed > 0 && <span className="pill fail">{totals.failed} failed</span>}
              </div>
              <div className="meta">
                <span>Folder <b>{project(current)}</b></span>
                <span>Started <b>{when(current.startedAt)}</b></span>
                <span>Tool calls <b>{totals.calls}</b></span>
                <span>Tokens out <b>{fmt(totals.output)}</b></span>
                <span>Cache read <b>{fmt(totals.cacheRead)}</b></span>
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
