// The record as a course. One lesson per concept: the reader's own code first, then the idea
// as a picture, the mechanism in steps, questions to commit to before revealing, and one
// exercise with a hint and a solution. Progress is a per-browser "read" mark, nothing more.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeWindow, LearningEntry, ProjectRecord } from '@agenttrace/shared';
import { Markdown, Code } from '../components/Markdown';

interface Props {
  /** the record endpoint for this repository, e.g. /api/projects/<id>/record */
  base: string;
  /** the repository's working copy, for the empty state */
  cwd: string;
}

const TYPES: LearningEntry['type'][] = ['library', 'tool', 'pattern', 'algorithm', 'math', 'architecture', 'design', 'security', 'testing', 'term'];
const SECTION_ORDER = ['In this project', 'What it is', 'Why here', 'The idea in one picture', 'How it works', 'Where to look', 'Check yourself', 'Try it', 'Go deeper'];

function readKey(project: string) {
  return `agenttrace-read:${project}`;
}
function loadRead(project: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(readKey(project)) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function Learn({ base, cwd }: Props) {
  const [record, setRecord] = useState<ProjectRecord | null | undefined>();
  const [pick, setPick] = useState<string>();
  const [type, setType] = useState<string>('all');
  const [tab, setTab] = useState<'learning' | 'decisions' | 'journal' | 'docs'>('learning');
  const [read, setRead] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRecord(undefined);
    fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: (ProjectRecord & { present?: boolean }) | null) => {
        const rec = r && r.present === false ? null : r;
        setRecord(rec);
        if (rec) setRead(loadRead(rec.project));
      })
      .catch(() => setRecord(null));
  }, [base]);

  const ordered = useMemo(() => (record ? orderByPrerequisites(record.learning) : []), [record]);
  const entries = useMemo(() => ordered.filter((l) => type === 'all' || l.type === type), [ordered, type]);
  const entry = record?.learning.find((l) => l.slug === pick);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of record?.learning ?? []) c[l.type] = (c[l.type] ?? 0) + 1;
    return c;
  }, [record]);

  const markRead = (slug: string, on: boolean) => {
    if (!record) return;
    const next = new Set(read);
    if (on) next.add(slug); else next.delete(slug);
    setRead(next);
    try { localStorage.setItem(readKey(record.project), JSON.stringify([...next])); } catch { /* per-browser convenience only */ }
  };

  const goNext = () => {
    if (!entry) return;
    markRead(entry.slug, true);
    const i = ordered.findIndex((l) => l.slug === entry.slug);
    const next = ordered.slice(i + 1).find((l) => !read.has(l.slug) && l.slug !== entry.slug) ?? ordered[i + 1];
    if (next) setPick(next.slug);
  };

  if (record === undefined) return <div className="empty" aria-busy="true">Reading the record…</div>;
  if (record === null) {
    return (
      <div className="empty">
        <h3>No record for this project yet.</h3>
        The Learn view reads a folder of lessons the coding tool keeps while it builds this repository. No
        <code> agenttrace.json </code> was found at <code>{cwd}</code>. Open Setup in the sidebar for the two files that turn
        it on; from the next session, lessons appear here.
      </div>
    );
  }

  const readCount = ordered.filter((l) => read.has(l.slug)).length;

  return (
    <div className="split learn">
      <aside className="files">
        <div className="learn-tabs">
          {(['learning', 'decisions', 'journal', 'docs'] as const).map((t) => (
            <button key={t} className={`btn sm quiet ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {t === 'learning' ? `Lessons ${record.learning.length}` : t === 'decisions' ? `Decisions ${record.decisions.length}` : t === 'journal' ? `Journal ${record.journal.length}` : 'Documents'}
            </button>
          ))}
        </div>
        {tab === 'learning' && (
          <>
            <div className="progress" aria-label="Lessons read">
              <span>{readCount} of {ordered.length} read</span>
              <i><b style={{ width: `${ordered.length ? (readCount / ordered.length) * 100 : 0}%` }} /></i>
            </div>
            <div className="learn-filter">
              <button className={`chip ${type === 'all' ? 'on' : ''}`} onClick={() => setType('all')}>all</button>
              {TYPES.filter((t) => counts[t]).map((t) => (
                <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t} {counts[t]}</button>
              ))}
            </div>
            {entries.map((l, i) => (
              <button key={l.slug} className={`node entry ${pick === l.slug ? 'sel' : ''} ${read.has(l.slug) ? 'read' : ''}`} onClick={() => setPick(l.slug)}>
                <span className="n">{read.has(l.slug) ? '✓' : i + 1}</span>
                <span className="p">{l.title}</span>
                <span className="c">{l.type} · {l.level} · {minutes(l)} min</span>
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
          <div className="notice">{record.unparsed.length} file{record.unparsed.length > 1 ? 's' : ''} could not be parsed: {record.unparsed.map((u) => u.file).join(', ')}</div>
        )}
      </aside>

      <section className="diffpane learnpane">
        {!pick && (
          <div className="empty">
            <h3>{record.project}: {record.learning.length} lessons, in the order they were needed.</h3>
            Each lesson opens on the lines of your own code where the idea lives, then explains it, then asks you two or three
            questions and gives you one thing to try. Lessons are ordered so that what a lesson needs comes before it.
            Start with the first unread one.
            <div className="doc-files"><button className="btn primary" onClick={() => setPick((ordered.find((l) => !read.has(l.slug)) ?? ordered[0])?.slug)}>Start</button></div>
          </div>
        )}
        {entry && pick && !pick.includes(':') && (
          <Lesson key={entry.slug} entry={entry} record={record} base={base} isRead={read.has(entry.slug)} onRead={(on) => markRead(entry.slug, on)} onPick={setPick} onNext={goNext} />
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
              <div className="doc-h"><span className="pill">{j.date}</span>{j.milestone && <span className="pill">{j.milestone}</span>}{j.reconstructed && <span className="pill" title={j.source ? `written from ${j.source}` : 'written after the fact'}>reconstructed</span>}{j.commits.length > 0 && <span className="c">commits {j.commits.join(', ')}</span>}</div>
              <h2>{j.summary}</h2>
              <Markdown text={j.body} />
              {j.learning.length > 0 && <div className="doc-files"><span className="c">Lessons from this session</span>{j.learning.map((n) => <button key={n} className="chip" onClick={() => { setTab('learning'); setPick(n); }}>{n}</button>)}</div>}
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
              <Code code={JSON.stringify(d.data, null, 2)} language="json" />
              <Markdown text={d.body} />
            </article>
          ) : null;
        })()}
      </section>
    </div>
  );
}

function Lesson({ entry, record, base, isRead, onRead, onPick, onNext }: { entry: LearningEntry; record: ProjectRecord; base: string; isRead: boolean; onRead: (on: boolean) => void; onPick: (slug: string) => void; onNext: () => void }) {
  const [code, setCode] = useState<CodeWindow | null | undefined>();
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [hint, setHint] = useState(false);
  const [solution, setSolution] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRevealed({}); setHint(false); setSolution(false);
    top.current?.scrollIntoView({ block: 'start' });
    const file = entry.files[0];
    if (!file) return void setCode(null);
    const q = new URLSearchParams({ file, ...(entry.anchor ? { anchor: entry.anchor } : {}) });
    fetch(`${base}?${q}`).then((r) => (r.ok ? r.json() : null)).then(setCode).catch(() => setCode(null));
  }, [entry, base]);

  const sections = useMemo(() => splitSections(entry.body), [entry.body]);
  const missing = (entry.prerequisites ?? []).filter((p) => !record.learning.some((l) => l.slug === p));
  const toc = SECTION_ORDER.filter((s) => (s === 'In this project' ? !!entry.files[0] : s === 'Check yourself' ? entry.questions.length > 0 : s === 'Try it' ? !!entry.exercise : sections.some((x) => x.title === s)));

  return (
    <article className="doc lesson" ref={top}>
      <div className="doc-h">
        <span className="pill">{entry.type}</span>
        <span className="pill">{entry.level}</span>
        {entry.reconstructed && <span className="pill" title={entry.source ? `written from ${entry.source}` : 'written after the fact'}>reconstructed</span>}
        <span className="c">{minutes(entry)} min read · introduced {entry.date.slice(0, 10)}</span>
      </div>
      <h2>{entry.title}</h2>
      <p className="lead">{entry.summary}</p>

      {(entry.prerequisites.length > 0 || entry.related.length > 0) && (
        <div className="doc-files path">
          {entry.prerequisites.map((p) => (
            <button key={p} className="chip" disabled={missing.includes(p)} onClick={() => onPick(p)} title={missing.includes(p) ? 'Not written yet' : 'Read this first'}>read first: {titleOf(record, p)}</button>
          ))}
          {entry.related.map((p) => (
            <button key={p} className="chip" disabled={!record.learning.some((l) => l.slug === p)} onClick={() => onPick(p)}>see also: {titleOf(record, p)}</button>
          ))}
        </div>
      )}

      <div className="lesson-grid">
        <div className="lesson-body">
          {entry.files[0] && (
            <section id="sec-in-this-project">
              <h3>In this project</h3>
              {code === undefined && <p className="c" aria-busy="true">Reading {entry.files[0]}…</p>}
              {code === null && <p className="c">The file <code>{entry.files[0]}</code> is not in the project folder right now.</p>}
              {code && (
                <>
                  <div className="codehead"><code>{code.path}</code><span className="c">lines {code.start} to {code.start + code.lines.length - 1} of {code.totalLines}{code.anchorLine ? `, ${entry.anchor} on line ${code.anchorLine}` : ''}</span></div>
                  <Code code={code.lines.join('\n')} language={code.language} start={code.start} highlight={code.anchorLine} />
                </>
              )}
            </section>
          )}
          {sections.map((s) => (
            <section key={s.title} id={`sec-${slugify(s.title)}`}>
              <h3>{s.title}</h3>
              <Markdown text={s.body} />
            </section>
          ))}
          {entry.questions.length > 0 && (
            <section id="sec-check-yourself">
              <h3>Check yourself</h3>
              <p className="c">Decide on your answer before you reveal one.</p>
              {entry.questions.map((q, i) => (
                <div key={i} className="quiz">
                  <p className="q">{q.q}</p>
                  {!revealed[i] && <button className="btn sm" onClick={() => setRevealed({ ...revealed, [i]: true })}>Reveal the answer</button>}
                  {revealed[i] && <p className="a">{q.a}</p>}
                </div>
              ))}
            </section>
          )}
          {entry.exercise && (
            <section id="sec-try-it">
              <h3>Try it</h3>
              <Markdown text={entry.exercise.task} />
              <div className="doc-files">
                {entry.exercise.hint && !hint && <button className="btn sm" onClick={() => setHint(true)}>Show a hint</button>}
                {entry.exercise.solution && !solution && <button className="btn sm" onClick={() => setSolution(true)}>Show the solution</button>}
              </div>
              {hint && entry.exercise.hint && <p className="a">{entry.exercise.hint}</p>}
              {solution && entry.exercise.solution && <Code code={entry.exercise.solution.trim()} language={code?.language ?? 'javascript'} />}
            </section>
          )}
          <div className="lesson-end">
            <label className="check"><input type="checkbox" checked={isRead} onChange={(e) => onRead(e.target.checked)} /> Mark as read</label>
            <button className="btn primary" onClick={onNext}>Next lesson</button>
          </div>
        </div>
        <nav className="toc" aria-label="On this page">
          <span className="c">On this page</span>
          {toc.map((t) => <button key={t} onClick={() => document.getElementById(`sec-${slugify(t)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{t}</button>)}
        </nav>
      </div>
    </article>
  );
}

/** Body sections by `## ` heading; a body in the older bold-label form becomes one section per label. */
function splitSections(body: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  const parts = body.split(/^## +/m);
  if (parts.length > 1) {
    for (const p of parts.slice(1)) {
      const nl = p.indexOf('\n');
      out.push({ title: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() });
    }
    return out;
  }
  for (const block of body.split(/\n{2,}/)) {
    const m = /^\*\*([^*]+)\.\*\*\s*/.exec(block);
    if (m) out.push({ title: m[1].replace(/:$/, ''), body: block.slice(m[0].length) });
    else if (out.length) out[out.length - 1].body += '\n\n' + block;
    else out.push({ title: 'What it is', body: block });
  }
  return out;
}

/** Prerequisites first: a stable topological order that keeps the recorded date order where it can. */
function orderByPrerequisites(list: LearningEntry[]): LearningEntry[] {
  const byslug = new Map(list.map((l) => [l.slug, l]));
  const done = new Set<string>();
  const out: LearningEntry[] = [];
  const visit = (l: LearningEntry, stack: Set<string>) => {
    if (done.has(l.slug) || stack.has(l.slug)) return;
    stack.add(l.slug);
    for (const p of l.prerequisites) { const q = byslug.get(p); if (q) visit(q, stack); }
    stack.delete(l.slug);
    done.add(l.slug);
    out.push(l);
  };
  for (const l of list) visit(l, new Set());
  return out;
}

function titleOf(record: ProjectRecord, slug: string): string {
  return record.learning.find((l) => l.slug === slug)?.title ?? slug;
}
function minutes(l: LearningEntry): number {
  const words = l.body.split(/\s+/).length + l.questions.reduce((n, q) => n + q.q.split(/\s+/).length + q.a.split(/\s+/).length, 0);
  return Math.max(1, Math.round(words / 180));
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
