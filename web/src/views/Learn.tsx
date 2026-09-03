// The record as a learning path: every concept the build introduced, in the order it appeared,
// with its explanation, the files it lives in, and the decisions and journal beside it.
import { useEffect, useMemo, useState } from 'react';
import type { LearningEntry, ProjectRecord } from '@agenttrace/shared';

interface Props {
  sessionId: string;
  cwd: string;
}

const TYPES: LearningEntry['type'][] = ['library', 'tool', 'pattern', 'algorithm', 'math', 'architecture', 'design', 'security', 'testing', 'term'];

export function Learn({ sessionId, cwd }: Props) {
  const [record, setRecord] = useState<ProjectRecord | null | undefined>();
  const [pick, setPick] = useState<string>();
  const [type, setType] = useState<string>('all');
  const [tab, setTab] = useState<'learning' | 'decisions' | 'journal' | 'docs'>('learning');

  useEffect(() => {
    setRecord(undefined);
    fetch(`/api/sessions/${sessionId}/record`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRecord)
      .catch(() => setRecord(null));
  }, [sessionId]);

  const entries = useMemo(() => (record?.learning ?? []).filter((l) => type === 'all' || l.type === type), [record, type]);
  const entry = entries.find((l) => l.slug === pick) ?? record?.learning.find((l) => l.slug === pick);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of record?.learning ?? []) c[l.type] = (c[l.type] ?? 0) + 1;
    return c;
  }, [record]);

  if (record === undefined) return <div className="empty" aria-busy="true">Reading the record…</div>;
  if (record === null) {
    return (
      <div className="empty">
        <h3>No record for this project yet.</h3>
        The Learn view reads a folder of notes the coding tool keeps while it builds. To start one, add an
        <code> agenttrace.json </code> at the project's root naming the folder, and install the agenttrace skill so
        each session writes entries as it introduces libraries, patterns and decisions. This session's folder is
        <code> {cwd}</code>.
      </div>
    );
  }

  return (
    <div className="split learn">
      <aside className="files">
        <div className="learn-tabs">
          {(['learning', 'decisions', 'journal', 'docs'] as const).map((t) => (
            <button key={t} className={`btn sm quiet ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {t === 'learning' ? `Concepts ${record.learning.length}` : t === 'decisions' ? `Decisions ${record.decisions.length}` : t === 'journal' ? `Journal ${record.journal.length}` : 'Documents'}
            </button>
          ))}
        </div>
        {tab === 'learning' && (
          <>
            <div className="learn-filter">
              <button className={`chip ${type === 'all' ? 'on' : ''}`} onClick={() => setType('all')}>all</button>
              {TYPES.filter((t) => counts[t]).map((t) => (
                <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t} {counts[t]}</button>
              ))}
            </div>
            {entries.map((l, i) => (
              <button key={l.slug} className={`node entry ${pick === l.slug ? 'sel' : ''}`} onClick={() => setPick(l.slug)}>
                <span className="n">{i + 1}</span>
                <span className="p">{l.title}</span>
                <span className="c">{l.type} · {l.level}</span>
              </button>
            ))}
          </>
        )}
        {tab === 'decisions' &&
          record.decisions.map((d) => (
            <button key={d.slug} className={`node entry ${pick === `d:${d.slug}` ? 'sel' : ''}`} onClick={() => setPick(`d:${d.slug}`)}>
              <span className="p">{d.title}</span>
              <span className="c">{d.status} · {d.date.slice(0, 10)}</span>
            </button>
          ))}
        {tab === 'journal' &&
          record.journal.map((j) => (
            <button key={j.slug} className={`node entry ${pick === `j:${j.slug}` ? 'sel' : ''}`} onClick={() => setPick(`j:${j.slug}`)}>
              <span className="p">{j.summary || j.slug}</span>
              <span className="c">{j.date}{j.milestone ? ` · ${j.milestone}` : ''}</span>
            </button>
          ))}
        {tab === 'docs' &&
          (['roadmap', 'stack', 'architecture', 'design', 'gaps'] as const).map((k) => (
            <button key={k} className={`node entry ${pick === `doc:${k}` ? 'sel' : ''}`} onClick={() => setPick(`doc:${k}`)} disabled={!record[k]}>
              <span className="p">{k}.md</span>
              <span className="c">{record[k] ? (record[k]!.updated ? String(record[k]!.updated).slice(0, 10) : 'present') : 'not written yet'}</span>
            </button>
          ))}
        {record.unparsed.length > 0 && (
          <div className="notice">
            {record.unparsed.length} file{record.unparsed.length > 1 ? 's' : ''} could not be parsed: {record.unparsed.map((u) => u.file).join(', ')}
          </div>
        )}
      </aside>
      <section className="diffpane learnpane">
        {!pick && (
          <div className="empty">
            <h3>{record.project}: {record.learning.length} concepts recorded.</h3>
            Pick one on the left. Each entry says what the thing is, why this project uses it, how it works, where to look in the code, and one exercise to try.
          </div>
        )}
        {entry && pick && !pick.includes(':') && (
          <article className="doc">
            <div className="doc-h">
              <span className="pill">{entry.type}</span>
              <span className="pill">{entry.level}</span>
              <span className="c">{entry.date.slice(0, 10)}</span>
            </div>
            <h2>{entry.title}</h2>
            <p className="lead">{entry.summary}</p>
            <Markdown text={entry.body} />
            {entry.files.length > 0 && (
              <div className="doc-files">
                <span className="c">Where to look</span>
                {entry.files.map((f) => <code key={f}>{f}</code>)}
              </div>
            )}
            {(entry.prerequisites.length > 0 || entry.related.length > 0) && (
              <div className="doc-files">
                {entry.prerequisites.map((p) => <button key={p} className="chip" onClick={() => setPick(p)}>needs: {p}</button>)}
                {entry.related.map((p) => <button key={p} className="chip" onClick={() => setPick(p)}>see also: {p}</button>)}
              </div>
            )}
          </article>
        )}
        {pick?.startsWith('d:') && (() => {
          const d = record.decisions.find((x) => `d:${x.slug}` === pick);
          return d ? (
            <article className="doc">
              <div className="doc-h"><span className={`pill ${d.status === 'accepted' ? 'ok' : ''}`}>{d.status}</span><span className="c">{d.date.slice(0, 10)}</span></div>
              <h2>{d.title}</h2>
              <Markdown text={d.body} />
            </article>
          ) : null;
        })()}
        {pick?.startsWith('j:') && (() => {
          const j = record.journal.find((x) => `j:${x.slug}` === pick);
          return j ? (
            <article className="doc">
              <div className="doc-h"><span className="pill">{j.date}</span>{j.milestone && <span className="pill">{j.milestone}</span>}{j.commits.length > 0 && <span className="c">commits {j.commits.join(', ')}</span>}</div>
              <h2>{j.summary}</h2>
              <Markdown text={j.body} />
              {j.next.length > 0 && <div className="doc-files"><span className="c">Next</span>{j.next.map((n) => <span key={n} className="chip">{n}</span>)}</div>}
            </article>
          ) : null;
        })()}
        {pick?.startsWith('doc:') && (() => {
          const k = pick.slice(4) as 'roadmap' | 'stack' | 'architecture' | 'design' | 'gaps';
          const d = record[k];
          return d ? (
            <article className="doc">
              <h2>{k}.md</h2>
              <pre className="fm">{JSON.stringify(d.data, null, 2)}</pre>
              <Markdown text={d.body} />
            </article>
          ) : null;
        })()}
      </section>
    </div>
  );
}

/** The record's bodies use a small, fixed subset of Markdown: bold, code, paragraphs, lists, fences. Rendered without HTML passthrough. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.startsWith('```')) {
          const body = b.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
          return <pre key={i} className="code">{body}</pre>;
        }
        if (/^(\d+\.|-)\s/.test(b)) {
          const items = b.split('\n').map((l) => l.replace(/^(\d+\.|-)\s/, ''));
          return b.startsWith('-') ? <ul key={i}>{items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul> : <ol key={i}>{items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
        }
        return <p key={i}><Inline text={b} /></p>;
      })}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}
    </>
  );
}
