// Every file the session touched, every version the coding tool backed up, and the diff between
// any version and the one before it. The last version can also be compared to the file on disk now.
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import type { Event, TrackedFile } from '@agenttrace/shared';
import { STACK } from '@agenttrace/shared';

interface Props {
  sessionId: string;
  events: Event[];
}

type Pick = { file: TrackedFile; index: number } | { file: TrackedFile; index: 'now' };

/** Lines rendered at once. A five-thousand-line file in one <pre> locks the tab. */
const WINDOW = 2000;
/** Above this the whole-strip read is skipped: counting every version of a huge file is not worth a frame. */
const PEEK_LIMIT = 300_000;

const key = (path: string, index: number | 'now') => `${path}|${index}`;

export function Diffs({ sessionId, events }: Props) {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [pick, setPick] = useState<Pick>();
  const [before, setBefore] = useState<string>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState<string>();
  const [whole, setWhole] = useState(false);
  const [peek, setPeek] = useState<string>();
  const [sizes, setSizes] = useState<Record<string, { add: number; del: number }>>({});
  const measured = useRef(new Set<string>());

  // Refetch the file list whenever a new snapshot event arrives.
  const snapshots = useMemo(() => events.filter((e) => e.kind === 'snapshot').length, [events]);
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/files`).then((r) => r.json()).then(setFiles).catch(() => setFiles([]));
  }, [sessionId, snapshots]);

  const stackByFile = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of events) if (e.kind === 'stack_detected' && e.file) m.set(e.file, [...(m.get(e.file) ?? []), e.tech]);
    return m;
  }, [events]);

  // Opening a file reads each of its versions once and counts the lines every edit changed, so
  // hovering the strip answers "which one was the big edit" before any diff is drawn.
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
    const v = pick.file.versions;
    const get = (q: string) => fetch(`/api/sessions/${sessionId}/files?${q}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))));
    const afterQ = pick.index === 'now' ? `path=${encodeURIComponent(pick.file.path)}` : `backup=${v[pick.index].backup}`;
    const beforeIdx = pick.index === 'now' ? v.length - 1 : pick.index - 1;
    const beforeP = beforeIdx >= 0 ? get(`backup=${v[beforeIdx].backup}`) : Promise.resolve('');
    Promise.all([beforeP, get(afterQ)])
      .then(([b, a]) => { setBefore(b); setAfter(a); })
      .catch((e) => setError(`Could not load this version (${e.message}). The backup may have been cleaned up.`));
  }, [pick, sessionId]);

  const hunks = useMemo(() => (before === undefined || after === undefined ? [] : diffLines(before, after)), [before, after]);
  const stats = useMemo(() => {
    let add = 0, del = 0;
    for (const h of hunks) { if (h.added) add += h.count ?? 0; if (h.removed) del += h.count ?? 0; }
    return { add, del };
  }, [hunks]);

  // The first two thousand lines, then the rest on request.
  const shown = useMemo(() => {
    const total = hunks.reduce((n, h) => n + (h.count ?? 0), 0);
    if (whole || total <= WINDOW) return { hunks, hidden: 0 };
    const out: typeof hunks = [];
    let n = 0;
    for (const h of hunks) {
      const c = h.count ?? 0;
      if (n + c <= WINDOW) { out.push(h); n += c; continue; }
      const room = WINDOW - n;
      if (room > 0) out.push({ ...h, value: h.value.split('\n').slice(0, room).join('\n') + '\n', count: room });
      n = WINDOW;
      break;
    }
    return { hunks: out, hidden: total - n };
  }, [hunks, whole]);

  return (
    <div className="split">
      <aside className="files">
        <h3>Files touched · {files.length}</h3>
        {files.length === 0 && <div className="empty">No file backups recorded for this session yet.</div>}
        {files.map((f) => (
          <div key={f.path} className="file">
            <Path path={f.path} />
            <div className="badges">
              {(stackByFile.get(f.path) ?? []).map((t) => (
                <span key={t} className="badge" title={STACK[t]?.what}>{t}</span>
              ))}
            </div>
            <div className="versions" onMouseLeave={() => setPeek(undefined)}>
              {f.versions.map((v, i) => (
                <button
                  key={v.backup}
                  className={`ver ${pick && pick.file.path === f.path && pick.index === i ? 'sel' : ''}`}
                  onClick={() => setPick({ file: f, index: i })}
                  title={stamp(v.backupTime)}
                  onMouseEnter={() => setPeek(key(f.path, i))}
                  onFocus={() => setPeek(key(f.path, i))}
                  onBlur={() => setPeek(undefined)}
                >
                  v{v.version}<small>{clock(v.backupTime)}</small>
                </button>
              ))}
              <button
                className={`ver current ${pick && pick.file.path === f.path && pick.index === 'now' ? 'sel' : ''}`}
                onClick={() => setPick({ file: f, index: 'now' })}
                onMouseEnter={() => setPeek(key(f.path, 'now'))}
                onFocus={() => setPeek(key(f.path, 'now'))}
                onBlur={() => setPeek(undefined)}
              >
                now
              </button>
              {peek && peek.startsWith(`${f.path}|`) && sizes[peek] && (
                <span className="verpeek"><b className="add">+{sizes[peek].add}</b> <b className="del">−{sizes[peek].del}</b> lines</span>
              )}
            </div>
          </div>
        ))}
      </aside>
      <section className="diffpane">
        {!pick && (
          <div className="empty">
            <h3>Pick a version.</h3>
            Each version is the file as it was just before an edit. The diff shows what that edit changed.
            "now" compares the last backup with the file on disk today.
          </div>
        )}
        {pick && error && <div className="empty">{error}</div>}
        {pick && !error && before !== undefined && (
          <>
            <div className="diffhead">
              <Path path={pick.file.path} />
              <span className="explain">
                {pick.index === 'now'
                  ? `Last backup compared with the file as it is now.`
                  : pick.index === 0
                    ? pick.file.versions[0].version > 1
                      ? `Created in this session. Version 1 is the moment before the file existed, so this is the whole file as first written.`
                      : `First backup. Nothing earlier in this session to compare with, so the whole file counts as added.`
                    : `Version ${pick.file.versions[pick.index].version} compared with version ${pick.file.versions[pick.index - 1].version}.`}
              </span>
              <span className="stats"><b className="add">+{stats.add}</b> <b className="del">−{stats.del}</b> lines</span>
            </div>
            <pre className="diff">
              {shown.hunks.map((h, i) => (
                <span key={i} className={h.added ? 'add' : h.removed ? 'del' : 'same'}>
                  {prefix(h.value, h.added ? '+' : h.removed ? '−' : ' ')}
                </span>
              ))}
            </pre>
            {shown.hidden > 0 && (
              <div className="difftail">
                <button className="btn quiet" onClick={() => setWhole(true)}>Show the rest ({shown.hidden.toLocaleString()} lines)</button>
                <p>The first {WINDOW.toLocaleString()} lines are drawn first so a long file does not stall the tab.</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function stamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function prefix(block: string, mark: string): string {
  const lines = block.endsWith('\n') ? block.slice(0, -1).split('\n') : block.split('\n');
  return lines.map((l) => `${mark} ${l}`).join('\n') + '\n';
}

/** The folders give way, the file name never does: it is the half that is actually read. */
function Path({ path }: { path: string }) {
  const parts = path.split(/[\\/]/);
  const base = parts.pop() ?? path;
  const dir = parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/');
  return (
    <div className="fpath" title={path}>
      {dir && <span className="dir">{dir}/</span>}
      <span className="base">{base}</span>
    </div>
  );
}
