// Every file the session touched, every version the coding tool backed up, and the diff between
// any version and the one before it. The last version can also be compared to the file on disk now.
import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import type { Event, TrackedFile } from '@agenttrace/shared';
import { STACK } from '@agenttrace/shared';

interface Props {
  sessionId: string;
  events: Event[];
}

type Pick = { file: TrackedFile; index: number } | { file: TrackedFile; index: 'now' };

export function Diffs({ sessionId, events }: Props) {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [pick, setPick] = useState<Pick>();
  const [before, setBefore] = useState<string>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState<string>();

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

  useEffect(() => {
    if (!pick) return;
    setError(undefined);
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

  return (
    <div className="split">
      <aside className="files">
        <h3>Files touched · {files.length}</h3>
        {files.length === 0 && <div className="empty small">No file backups recorded for this session yet.</div>}
        {files.map((f) => (
          <div key={f.path} className="file">
            <div className="fpath" title={f.path}>{shortPath(f.path)}</div>
            <div className="badges">
              {(stackByFile.get(f.path) ?? []).map((t) => (
                <span key={t} className="badge" title={STACK[t]?.what}>{t}</span>
              ))}
            </div>
            <div className="versions">
              {f.versions.map((v, i) => (
                <button
                  key={v.backup}
                  className={`ver ${pick && pick.file.path === f.path && pick.index === i ? 'sel' : ''}`}
                  onClick={() => setPick({ file: f, index: i })}
                  title={v.backupTime}
                >
                  v{v.version}<small>{clock(v.backupTime)}</small>
                </button>
              ))}
              <button className={`ver now ${pick && pick.file.path === f.path && pick.index === 'now' ? 'sel' : ''}`} onClick={() => setPick({ file: f, index: 'now' })}>
                now
              </button>
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
              <span className="fpath">{shortPath(pick.file.path)}</span>
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
              {hunks.map((h, i) => (
                <span key={i} className={h.added ? 'add' : h.removed ? 'del' : 'same'}>
                  {prefix(h.value, h.added ? '+' : h.removed ? '−' : ' ')}
                </span>
              ))}
            </pre>
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

function prefix(block: string, mark: string): string {
  const lines = block.endsWith('\n') ? block.slice(0, -1).split('\n') : block.split('\n');
  return lines.map((l) => `${mark} ${l}`).join('\n') + '\n';
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.length > 4 ? '…/' + parts.slice(-4).join('/') : p;
}
