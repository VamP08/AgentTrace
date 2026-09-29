// Every file the session touched, every version the coding tool backed up, and the diff between
// any version and the one before it. The last version can also be compared to the file on disk now.
//
// Three regions and no more: the files as a folded tree, then the open file as three sections
// (figures, versions on the session's clock, changes). Why a version exists (the turn that asked,
// the calls before it) is one click away in a drawer, not a third column, which is what made the
// round-4 screen read as cramped.
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import type { Event, TrackedFile } from '@agenttrace/shared';
import { STACK, gloss } from '@agenttrace/shared';
import { buildTurns } from './Timeline';
import './files.css';

interface Props {
  sessionId: string;
  events: Event[];
}

type Pick = { file: TrackedFile; index: number } | { file: TrackedFile; index: 'now' };
type Line = { t: 'same' | 'add' | 'del'; a?: number; b?: number; text: string };
type Row = Line | { t: 'fold'; from: number; count: number };

/** Lines rendered at once. A five-thousand-line file in one block locks the tab. */
const WINDOW = 2000;
/** Above this the whole-strip read is skipped: counting every version of a huge file is not worth a frame. */
const PEEK_LIMIT = 300_000;
/** Unchanged lines kept on each side of a change before the rest folds. */
const CONTEXT = 3;
/** Calls that change a file's content through its path. */
const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Nearest two version marks may sit on the track, in percent of its width. */
const MIN_GAP = 5;

const key = (path: string, index: number | 'now') => `${path}|${index}`;

export function Diffs({ sessionId, events }: Props) {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [pick, setPick] = useState<Pick>();
  const [before, setBefore] = useState<string>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState<string>();
  const [whole, setWhole] = useState(false);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [closedDirs, setClosedDirs] = useState<Set<string>>(new Set());
  const [why, setWhy] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { add: number; del: number }>>({});
  const measured = useRef(new Set<string>());

  // Refetch the file list whenever a new snapshot event arrives. Which session the list is for is
  // kept beside it: until this session's list has arrived the view says it is reading, because an
  // empty list shown meanwhile said "no file backups" of a session that had changed 65 files.
  const [listedFor, setListedFor] = useState<string>();
  const snapshots = useMemo(() => events.filter((e) => e.kind === 'snapshot').length, [events]);
  useEffect(() => {
    let dead = false;
    fetch(`/api/sessions/${sessionId}/files`)
      .then((r) => r.json())
      .catch(() => [])
      .then((list: TrackedFile[]) => {
        if (dead) return;
        setFiles(list);
        setListedFor(sessionId);
      });
    return () => {
      dead = true;
    };
  }, [sessionId, snapshots]);
  const listing = listedFor !== sessionId;

  // Opening the session opens the file it rewrote most, at its last version: an empty pane that
  // says "pick one" is a question the list already answers.
  useEffect(() => {
    if (listing || files.length === 0) return;
    if (pick && files.some((f) => f.path === pick.file.path)) return;
    const most = files.reduce((a, b) => (b.versions.length > a.versions.length ? b : a));
    setPick({ file: most, index: most.versions.length - 1 });
  }, [listing, files]); // eslint-disable-line react-hooks/exhaustive-deps

  const stackByFile = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of events) if (e.kind === 'stack_detected' && e.file) m.set(e.file, [...(m.get(e.file) ?? []), e.tech]);
    return m;
  }, [events]);

  const turns = useMemo(() => buildTurns(events), [events]);
  const span = useMemo(() => {
    const ts = events.map((e) => e.ts).filter(Boolean).sort();
    return { from: ts[0] ?? '', to: ts[ts.length - 1] ?? '' };
  }, [events]);

  // Opening a file reads each of its versions once and counts the lines every edit changed, so
  // the figures and the version track can say which one was the big edit before any diff is drawn.
  const openPath = pick?.file.path;
  useEffect(() => {
    const f = files.find((x) => x.path === openPath);
    if (!f || f.versions.length > 12 || measured.current.has(f.path)) return;
    measured.current.add(f.path);
    let alive = true;
    const get = (q: string) => fetch(`/api/sessions/${sessionId}/files?${q}`).then((r) => (r.ok ? r.text() : ''));
    Promise.all([...f.versions.map((v) => get(`backup=${v.backup}`)), get(`path=${encodeURIComponent(f.path)}`)])
      .then((texts) => {
        if (!alive || texts.some((t) => t.length > PEEK_LIMIT)) return;
        const next: Record<string, { add: number; del: number }> = {};
        for (let i = 0; i < texts.length; i++) {
          let add = 0, del = 0;
          for (const h of diffLines(i === 0 ? '' : texts[i - 1], texts[i])) {
            if (h.added) add += h.count ?? 0;
            if (h.removed) del += h.count ?? 0;
          }
          next[key(f.path, i === f.versions.length ? 'now' : i)] = { add, del };
        }
        setSizes((s) => ({ ...s, ...next }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [openPath, files, sessionId]);

  useEffect(() => {
    if (!pick) return;
    setError(undefined);
    setWhole(false);
    setOpened(new Set());
    setBefore(undefined);
    const v = pick.file.versions;
    const get = (q: string) => fetch(`/api/sessions/${sessionId}/files?${q}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))));
    const afterQ = pick.index === 'now' ? `path=${encodeURIComponent(pick.file.path)}` : `backup=${v[pick.index].backup}`;
    const beforeIdx = pick.index === 'now' ? v.length - 1 : pick.index - 1;
    const beforeP = beforeIdx >= 0 ? get(`backup=${v[beforeIdx].backup}`) : Promise.resolve('');
    Promise.all([beforeP, get(afterQ)])
      .then(([b, a]) => { setBefore(b); setAfter(a); })
      .catch((e) => setError(`Could not load this version (${e.message}). The backup may have been cleaned up.`));
  }, [pick, sessionId]);

  // Numbered lines, then long unchanged runs folded down to a few lines of context either side.
  const { rows, stats, hidden } = useMemo(() => {
    const lines: Line[] = [];
    let add = 0, del = 0, a = 1, b = 1;
    if (before !== undefined && after !== undefined) {
      for (const h of diffLines(before, after)) {
        const parts = h.value.endsWith('\n') ? h.value.slice(0, -1).split('\n') : h.value.split('\n');
        for (const text of parts) {
          if (h.added) { lines.push({ t: 'add', b: b++, text }); add++; }
          else if (h.removed) { lines.push({ t: 'del', a: a++, text }); del++; }
          else lines.push({ t: 'same', a: a++, b: b++, text });
        }
      }
    }
    const near = new Uint8Array(lines.length);
    lines.forEach((l, i) => {
      if (l.t === 'same') return;
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) near[k] = 1;
    });
    const out: Row[] = [];
    for (let i = 0; i < lines.length; ) {
      if (near[i]) { out.push(lines[i]); i++; continue; }
      let j = i;
      while (j < lines.length && !near[j]) j++;
      if (j - i <= 2 || opened.has(i)) out.push(...lines.slice(i, j));
      else out.push({ t: 'fold', from: i, count: j - i });
      i = j;
    }
    const cut = !whole && out.length > WINDOW;
    return { rows: cut ? out.slice(0, WINDOW) : out, stats: { add, del }, hidden: cut ? out.length - WINDOW : 0 };
  }, [before, after, opened, whole]);

  // The tree: files under the folder they sit in, folders in the order their first file was touched.
  const tree = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
    const root = commonDir(files.map((f) => f.path));
    const dirs = new Map<string, TrackedFile[]>();
    for (const f of shown) {
      const rel = f.path.slice(root.length).replace(/^[\\/]/, '');
      const parts = rel.split(/[\\/]/);
      parts.pop();
      const dir = parts.join('/') || '.';
      dirs.set(dir, [...(dirs.get(dir) ?? []), f]);
    }
    return { root, dirs: [...dirs.entries()] };
  }, [files, filter]);

  const f = pick?.file;
  const idx = pick ? (pick.index === 'now' ? f!.versions.length : pick.index) : 0;
  const cur = f && pick && pick.index !== 'now' ? f.versions[pick.index] : undefined;
  const totalAdd = f ? f.versions.reduce((n, _, i) => n + (sizes[key(f.path, i)]?.add ?? 0), 0) : 0;
  const totalDel = f ? f.versions.reduce((n, _, i) => n + (sizes[key(f.path, i)]?.del ?? 0), 0) : 0;
  const measuredAll = !!f && f.versions.every((_, i) => sizes[key(f.path, i)]);
  const places = useMemo(() => (f ? spread(f.versions.map((v) => pos(v.backupTime, span))) : []), [f, span]);

  // Why this version. The tool backs a file up when a turn starts, so a version holds what the
  // writes since the previous backup left behind: the last Write or Edit on this path in that window
  // made it, and the turn that call belongs to asked for it. Reading the backup's own turn instead
  // blamed a turn that had not touched the file yet.
  const reason = useMemo(() => {
    if (!f || !cur || pick?.index === 'now') return undefined;
    const i = pick!.index as number;
    const after = i > 0 ? f.versions[i - 1].backupTime : '';
    const writes = events.filter(
      (e): e is Extract<Event, { kind: 'tool_call' }> =>
        e.kind === 'tool_call' && WRITES.has(e.name) && e.ts > after && e.ts <= cur.backupTime && samePath((e.input as any)?.file_path, f.path),
    );
    const wrote = writes[writes.length - 1];
    const turn = wrote ? turns.find((t) => t.events.includes(wrote)) : undefined;
    const calls = turn && wrote ? (turn.events.filter((e) => e.kind === 'tool_call' && e.ts <= wrote.ts) as Extract<Event, { kind: 'tool_call' }>[]).slice(-6) : [];
    const touched = turns.filter((t) => [...t.files].some((p) => samePath(p, f.path))).map((t) => t.n);
    return { turn, calls, wrote, writes: writes.length, touched };
  }, [f, cur, pick, events, turns]);

  useEffect(() => {
    if (!why) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setWhy(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [why]);

  const explain = !f || !pick
    ? ''
    : pick.index === 'now'
      ? 'The last backup compared with the file as it is on disk now.'
      : pick.index === 0
        ? f.versions[0].version > 1
          ? 'Created in this session: the whole file as first written.'
          : 'The first backup. Nothing earlier in this session to compare with, so the whole file counts as added.'
        : `Version ${f.versions[pick.index].version} compared with version ${f.versions[pick.index - 1].version}.`;

  return (
    <div className="fx">
      <aside className="fx-tree" aria-label="Files this session touched">
        <div className="fx-tree-top">
          <h2>Files <span>{listing ? '…' : files.length}</span></h2>
          {files.length > 6 && <input type="search" className="fx-filter" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter files" />}
        </div>
        {listing && <p className="fx-note" aria-busy="true">Reading which files this session changed…</p>}
        {!listing && files.length === 0 && <p className="fx-note">No file backups recorded for this session yet.</p>}
        {!listing && tree.dirs.map(([dir, list]) => {
          const closed = closedDirs.has(dir);
          return (
            <div key={dir} className="fx-dir">
              <button className="fx-dir-h" aria-expanded={!closed} onClick={() => setClosedDirs((s) => { const n = new Set(s); if (closed) n.delete(dir); else n.add(dir); return n; })} title={`${tree.root}/${dir}`}>
                <span className={`chev ${closed ? 'closed' : ''}`} aria-hidden />
                <span className="d">{shortDir(dir)}</span>
                <span className="c">{list.length}</span>
              </button>
              {!closed && list.map((x) => (
                <button key={x.path} className={`fx-file ${f?.path === x.path ? 'on' : ''}`} onClick={() => setPick({ file: x, index: x.versions.length - 1 })} title={`${x.path}\n${x.versions.length} version${x.versions.length === 1 ? '' : 's'}`} aria-current={f?.path === x.path ? 'true' : undefined}>
                  <span className="n">{base(x.path)}</span>
                  <Heat n={x.versions.length} />
                </button>
              ))}
            </div>
          );
        })}
        {!listing && files.length > 0 && <p className="fx-legend"><Heat n={4} /> one square per saved version</p>}
      </aside>

      <section className="fx-main">
        {!f && !listing && files.length > 0 && <p className="fx-note">Pick a file.</p>}
        {f && pick && (
          <>
            <header className="fx-head">
              <div>
                <p className="fx-path" title={f.path}>{dirOf(f.path)}</p>
                <h1>{base(f.path)}</h1>
                {(stackByFile.get(f.path) ?? []).length > 0 && (
                  <p className="fx-uses">Uses {(stackByFile.get(f.path) ?? []).map((t, i) => <span key={t} title={STACK[t]?.what}>{i > 0 ? ', ' : ''}{t}</span>)}</p>
                )}
              </div>
              <button className={`btn ${pick.index === 'now' ? 'on' : ''}`} onClick={() => setPick({ file: f, index: 'now' })}>Compare with the file now</button>
            </header>

            <dl className="fx-figs">
              <div><dt>versions</dt><dd>{f.versions.length}</dd></div>
              <div><dt>lines added</dt><dd>{measuredAll ? `+${totalAdd}` : '…'}</dd></div>
              <div><dt>lines removed</dt><dd>{measuredAll ? `−${totalDel}` : '…'}</dd></div>
              {reason && reason.touched.length > 0 && <div><dt>turns that wrote it</dt><dd>{reason.touched.join(', ')}</dd></div>}
            </dl>

            <section className="fx-sec" aria-labelledby="fx-versions">
              <header><h2 id="fx-versions">Versions</h2><span className="meta">{clock(span.from)} to {clock(span.to)}</span></header>
              <div className="fx-track" role="group" aria-label="Saved versions on the session's clock">
                {f.versions.map((v, i) => {
                  const s = sizes[key(f.path, i)];
                  return (
                    <button key={v.backup} className="fx-pt" style={{ left: `${places[i]}%` }} aria-pressed={idx === i} onClick={() => setPick({ file: f, index: i })} title={`${stamp(v.backupTime)}${s ? `, +${s.add} −${s.del} lines` : ''}`}>
                      <i>v{v.version}</i>{(idx === i || i === 0 || i === f.versions.length - 1) && <span>{clock(v.backupTime)}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="fx-picked">
                <p>
                  {cur ? <><b>v{cur.version}</b>, saved at {clock(cur.backupTime)}. </> : <><b>Now</b>. </>}
                  {explain}
                  {reason?.turn && reason.wrote && ` Written in turn ${reason.turn.n} by ${reason.wrote.name}.`}
                  {reason && !reason.wrote && pick.index !== 0 && ' No Write or Edit touched this file in between, so a command or a helper changed it.'}
                </p>
                {cur && reason?.turn && reason.wrote && <button className="btn primary" onClick={() => setWhy(true)}>Why this version</button>}
              </div>
            </section>

            <section className="fx-sec" aria-labelledby="fx-changes">
              <header>
                <h2 id="fx-changes">Changes</h2>
                {before !== undefined && !error && <span className="meta"><b className="add">+{stats.add}</b> <b className="del">−{stats.del}</b> lines</span>}
              </header>
              {error && <p className="fx-note">{error}</p>}
              {!error && before === undefined && <p className="fx-note" aria-busy="true">Reading both versions…</p>}
              {!error && before !== undefined && (
                <div className="fx-diff">
                  {rows.length === 0 && <p className="fx-note">The two versions are the same.</p>}
                  {rows.map((r, i) =>
                    r.t === 'fold' ? (
                      <button key={`f${r.from}`} className="fx-fold" onClick={() => setOpened((s) => new Set(s).add(r.from))}>
                        {r.count} unchanged lines
                      </button>
                    ) : (
                      <div key={i} className={`fx-l ${r.t}`}>
                        <span className="a">{r.a ?? ''}</span>
                        <span className="b">{r.b ?? ''}</span>
                        <span className="m">{r.t === 'add' ? '+' : r.t === 'del' ? '−' : ''}</span>
                        <span className="x">{r.text}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
              {hidden > 0 && (
                <div className="difftail">
                  <button className="btn quiet" onClick={() => setWhole(true)}>Show the rest ({hidden.toLocaleString()} lines)</button>
                  <p>The first {WINDOW.toLocaleString()} lines are drawn first so a long file does not stall the tab.</p>
                </div>
              )}
            </section>
          </>
        )}
      </section>

      {why && reason?.turn && reason.wrote && cur && f && (
        <>
          <button className="fx-scrim" aria-label="Close" onClick={() => setWhy(false)} />
          <aside className="fx-drawer" role="dialog" aria-modal="true" aria-labelledby="fx-why">
            <header>
              <h2 id="fx-why">Why v{cur.version} exists</h2>
              <button className="btn" onClick={() => setWhy(false)} autoFocus>Close</button>
            </header>
            <section>
              <h3>Asked for in turn {reason.turn.n}</h3>
              <blockquote>{reason.turn.prompt || '(an image, no words)'}</blockquote>
            </section>
            <section>
              <h3>The calls that led to it</h3>
              {reason.calls.map((c) => (
                <div key={c.id} className={`fx-step ${c === reason.wrote ? 'on' : ''}`}>
                  <span>{clock(c.ts, true)}</span>
                  <span>{c.name} {target(c.input)}{c === reason.wrote ? ', which left this version' : ''}</span>
                </div>
              ))}
              {reason.writes > 1 && <p className="fx-note fx-more">{reason.writes} writes to this file between the two versions; the last is marked.</p>}
              <details className="fx-gloss">
                <summary>What {reason.wrote.name} does</summary>
                <p>{gloss(reason.wrote.name).what}</p>
              </details>
            </section>
            <section>
              <h3>This file across the session</h3>
              <div className="fx-step"><span>versions</span><span>{f.versions.length}</span></div>
              <div className="fx-step"><span>turns</span><span>{reason.touched.join(', ') || 'none by Write or Edit'}</span></div>
              <div className="fx-step"><span>last saved</span><span>{stamp(f.versions[f.versions.length - 1].backupTime)}</span></div>
            </section>
          </aside>
        </>
      )}
    </div>
  );
}

/** One square per saved version, four at most; more versions show the count instead of a fifth. */
function Heat({ n }: { n: number }) {
  return (
    <span className="heat" aria-hidden>
      {[0, 1, 2, 3].map((i) => <i key={i} className={i < n ? `h${i + 1}` : ''} />)}
      {n > 4 && <b>{n}</b>}
    </span>
  );
}

function samePath(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}
function target(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const v = i.file_path ?? i.path ?? i.pattern ?? i.command ?? i.description ?? '';
  const s = String(v);
  return /[\\/]/.test(s) && !/\s/.test(s) ? base(s) : s.length > 60 ? s.slice(0, 60) + '…' : s;
}
function commonDir(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split(/[\\/]/).slice(0, -1));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const part = split[0][i];
    if (part === undefined || split.some((s) => s[i] !== part)) break;
    out.push(part);
  }
  return out.join('/');
}
function base(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
function dirOf(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return (parts.length > 4 ? '…/' + parts.slice(-4).join('/') : parts.join('/')) + '/';
}
function pos(ts: string, span: { from: string; to: string }): number {
  const a = new Date(span.from).getTime(), b = new Date(span.to).getTime(), t = new Date(ts).getTime();
  if (!(b > a) || !Number.isFinite(t)) return 50;
  return 4 + Math.min(1, Math.max(0, (t - a) / (b - a))) * 92;
}
/**
 * Versions saved seconds apart would sit on one another, so each mark keeps a minimum gap from the
 * one before it, and the run is squeezed back inside the track if that pushed it past the end. The
 * order and the rough place on the clock survive; the exact time is in each mark's title.
 */
function spread(at: number[]): number[] {
  const out = [...at];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + MIN_GAP);
  const first = out[0], last = out[out.length - 1];
  if (last <= 96 || last === first) return out;
  // ponytail: past about eighteen versions the squeeze closes the gaps again; the titles still tell them apart
  return out.map((x) => 4 + ((x - first) / (last - first)) * 92);
}
function shortDir(dir: string): string {
  if (dir === '.') return 'top folder';
  const parts = dir.split('/');
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : dir;
}
function clock(ts: string, seconds = false): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });
}
function stamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
