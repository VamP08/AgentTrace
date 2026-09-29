// Ask the record a question instead of asking the agent again.
//
// One box over every record on this machine: lessons, decisions, journal entries, stack rows,
// gaps, milestones and the shared library. A result carries its links, so a symbol found in a
// lesson leads to the decision that named the same file and to the commits that came out of it.
import { useEffect, useRef, useState } from 'react';
import type { Hit, Link, SearchResult } from '@agenttrace/shared';

interface Props {
  onOpenSession: (id: string) => void;
  /** open an entry of a record where it lives; false when no project owns it */
  onOpenRecord: (project: string, kind: string, id: string) => boolean;
  onClose: () => void;
}

const KIND_SAYS: Record<Hit['kind'], string> = {
  stack: 'a technology in use, with why it was chosen',
  lesson: 'a lesson written for this project',
  library: 'a shared entry, written once and read from every project',
  decision: 'a choice that was argued out',
  journal: 'a working session',
  gap: 'a known problem',
  milestone: 'a milestone and its gate',
};

/** A file or a commit is not a page in this app, so following one searches for it instead. */
const searched = (l: Link) => l.kind === 'file' || l.kind === 'commit';

export function Search({ onOpenSession, onOpenRecord, onClose }: Props) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResult>();
  const [failed, setFailed] = useState(false);
  // A search in flight says so. The first one after a record changes rebuilds the index, and an
  // empty page while that happens read as "nothing found".
  const [pending, setPending] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => box.current?.focus(), []);

  useEffect(() => {
    if (!q.trim()) {
      setResult(undefined);
      setPending(false);
      return;
    }
    let dead = false;
    setPending(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=40`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((x) => !dead && (setResult(x), setFailed(false)))
        .catch(() => !dead && setFailed(true))
        .finally(() => !dead && setPending(false));
    }, 180);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q]);

  // A link opens what it names: a lesson, a decision, a journal entry, a gap or a milestone in its
  // project, a session in the session view. Files and commits are searched for, which lists every
  // entry that names them. Every link used to search, so a reader could find a lesson and never read it.
  const follow = (l: Link, from: Hit) => {
    if (l.kind === 'session') {
      onOpenSession(l.id);
      onClose();
      return;
    }
    if (searched(l) || !onOpenRecord(l.project ?? from.project, l.kind, l.id)) setQ(l.id);
  };

  return (
    <div className="scroll">
      <section className="explainer" aria-label="What this searches">
        <h3>Search the record</h3>
        <p>
          Every record on this machine: the lessons, the decisions, the journal, the technologies and why each was chosen,
          the known gaps, the milestones, and the shared library. It reads the Markdown files themselves, so what you
          find here is exactly what was written down — nothing is generated and nothing is inferred.
        </p>
        <div className="srch">
          <input
            ref={box}
            type="search"
            value={q}
            placeholder="why is chokidar here"
            aria-label="Search the record"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : onClose())}
          />
        </div>
        {pending && <p className="now-p small" aria-live="polite">Searching…</p>}
        {!pending && result && (
          <p className="now-p small">
            {result.total === 0
              ? `Nothing in the record matches every word of that. ${result.indexed.docs} entries were searched, across ${result.indexed.projects.join(' and ') || 'no project'}.`
              : `${result.total} match${result.total === 1 ? '' : 'es'} in ${result.indexed.docs} entries, in ${result.tookMs} ms. Open a title to read it.`}
          </p>
        )}
        {failed && <p className="now-p">The server could not answer that search.</p>}
      </section>

      {!q.trim() && (
        <section className="dg">
          <h3>Things worth asking</h3>
          <ul className="dg-notes">
            {['why is chokidar here', 'byte offset', 'tail.ts', 'M9'].map((x) => (
              <li key={x}>
                <button className="btn sm quiet" onClick={() => setQ(x)}>{x}</button>
                <span className="c">{x === 'M9' ? 'a milestone id' : x.includes('.ts') ? 'a file, and everything that names it' : x === 'byte offset' ? 'a phrase in a lesson' : 'a question about a dependency'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result?.hits.map((h) => (
        <article className="hit" key={`${h.kind}:${h.project}:${h.id}`}>
          <div className="hit-h">
            <span className="kind">{h.kind}</span>
            <h4><button className="hit-open" onClick={() => onOpenRecord(h.project, h.kind, h.id)}>{h.title}</button></h4>
            <span className="c">{h.project || 'shared library'}{h.summary && h.kind !== 'stack' ? ` · ${h.summary}` : ''}</span>
          </div>
          <p className="hit-s">{h.snippet}</p>
          <div className="hit-f">
            <span className="c">{KIND_SAYS[h.kind]} · matched in {h.matched.join(', ')}</span>
          </div>
          {h.links.length > 0 && (
            <div className="hit-l">
              {h.links.map((l, i) => (
                <button key={i} className="chip" onClick={() => follow(l, h)} title={searched(l) ? `Search for ${l.id}` : `Open: ${l.label}`}>
                  <span className="k">{searched(l) ? `${l.kind} · search` : l.kind}</span>
                  {l.kind === 'session' ? 'open the session' : l.id}
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
