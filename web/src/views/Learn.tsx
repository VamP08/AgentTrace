// The record as a course. One lesson per concept: the reader's own code first, then the idea
// as a picture, the mechanism in steps, questions to commit to before revealing, and one
// exercise with a hint and a solution. Progress is a per-browser "read" mark, nothing more.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeWindow, Completeness, LearningEntry, LibraryEntry, ProjectRecord } from '@agenttrace/shared';
import { SLOT_LABELS, completeness, sections as splitSlots } from '@agenttrace/shared';
import { Markdown, Code } from '../components/Markdown';
import './read.css';

interface Props {
  /** the record endpoint for this repository, e.g. /api/projects/<id>/record */
  base: string;
  /** the repository's working copy, for the empty state */
  cwd: string;
}

const TYPES: LearningEntry['type'][] = ['library', 'tool', 'pattern', 'algorithm', 'math', 'architecture', 'design', 'security', 'testing', 'term'];
const SECTION_ORDER = ['In this project', 'What it is', 'Why here', 'The idea in one picture', 'How it works', 'Where to look', 'Check yourself', 'Try it', 'Go deeper'];
const DOCS = ['roadmap', 'stack', 'architecture', 'design', 'gaps'] as const;

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
  const [tab, setTab] = useState<'learning' | 'library' | 'decisions' | 'journal' | 'docs'>('learning');
  const [brief, setBrief] = useState<string>();
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

  /** A [[slug]] in record text, or a chip: open that lesson, or that decision, or stay put. */
  const openSlug = (slug: string) => {
    if (record?.learning.some((l) => l.slug === slug)) { setTab('learning'); setPick(slug); }
    else if (record?.decisions.some((d) => d.slug === slug)) { setTab('decisions'); setPick(`d:${slug}`); }
  };

  const goNext = () => {
    if (!entry) return;
    markRead(entry.slug, true);
    const i = ordered.findIndex((l) => l.slug === entry.slug);
    const next = ordered.slice(i + 1).find((l) => !read.has(l.slug) && l.slug !== entry.slug) ?? ordered[i + 1];
    if (next) setPick(next.slug);
  };

  if (record === undefined) return <div className="empty rd-empty" aria-busy="true">Reading the record…</div>;
  if (record === null) {
    return (
      <div className="empty rd-empty">
        <h3>No record for this project yet.</h3>
        The Learn view reads a folder of lessons the coding tool keeps while it builds this repository. No
        <code> agenttrace.json </code> was found at <code>{cwd}</code>. Open Setup in the sidebar for the two files that turn
        it on; from the next session, lessons appear here.
      </div>
    );
  }

  const readCount = ordered.filter((l) => read.has(l.slug)).length;
  const docCount = DOCS.filter((k) => record[k]).length;
  const tabs = {
    learning: `Lessons ${record.learning.length}`,
    library: `Library ${record.library.length}`,
    decisions: `Decisions ${record.decisions.length}`,
    journal: `Journal ${record.journal.length}`,
    docs: `Documents ${docCount}`,
  };

  return (
    <div className="split rd-split">
      <aside className="files rd-rail">
        <div className="rd-tabs">
          {(['learning', 'library', 'decisions', 'journal', 'docs'] as const).map((t) => (
            <button key={t} className={`btn sm ${tab === t ? 'on' : ''}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {tabs[t]}
            </button>
          ))}
        </div>
        <div className="rd-row rd-briefrow">
          <button
            className="btn sm quiet"
            onClick={() => {
              if (brief !== undefined) return setBrief(undefined);
              fetch(`${base.replace(/\/record$/, '/brief')}?format=md`)
                .then((r) => (r.ok ? r.text() : 'The brief could not be built.'))
                .then(setBrief);
            }}
          >
            {brief === undefined ? 'What is missing' : 'Hide what is missing'}
          </button>
        </div>
        {tab === 'learning' && (
          <>
            <div className="rd-progress" aria-label="Lessons read">
              <span>{readCount} of {ordered.length} read</span>
              <i><b style={{ width: `${ordered.length ? (readCount / ordered.length) * 100 : 0}%` }} /></i>
            </div>
            <div className="rd-filter">
              <button className={`rd-chip ${type === 'all' ? 'on' : ''}`} aria-pressed={type === 'all'} onClick={() => setType('all')}>all</button>
              {TYPES.filter((t) => counts[t]).map((t) => (
                <button key={t} className={`rd-chip ${type === t ? 'on' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}>{t} {counts[t]}</button>
              ))}
            </div>
            {entries.map((l, i) => (
              <button key={l.slug} className={`node rd-entry rd-num ${pick === l.slug ? 'sel' : ''} ${read.has(l.slug) ? 'read' : ''}`} onClick={() => setPick(l.slug)}>
                <span className="rd-n">{i + 1}</span>
                <span className="rd-t">{l.title}</span>
                <span className="rd-m">{l.type} · {l.level} · {minutes(l)} min{read.has(l.slug) ? ' · read' : ''}</span>
              </button>
            ))}
          </>
        )}
        {tab === 'library' && (
          record.library.length === 0 ? (
            <div className="rd-alert">
              No library is configured for this project. Add a <code>library</code> path to <code>agenttrace.json</code> and
              shared entries appear here, one per concept, reused by every project that uses it.
            </div>
          ) : (
            record.library.map((e) => {
              const c = completeness(e);
              return (
                <button key={e.key} className={`node rd-entry ${pick === `lib:${e.key}` ? 'sel' : ''}`} onClick={() => setPick(`lib:${e.key}`)}>
                  <span className="rd-t">{e.title}</span>
                  <span className="rd-m">{e.type} · {c.written} of {c.fillable} slots{c.complete ? ' · complete' : ''}</span>
                </button>
              );
            })
          )
        )}
        {tab === 'decisions' &&
          record.decisions.map((d) => (
            <button key={d.slug} className={`node rd-entry ${pick === `d:${d.slug}` ? 'sel' : ''}`} onClick={() => setPick(`d:${d.slug}`)}>
              <span className="rd-t">{d.title}</span>
              <span className="rd-m">{d.status} · {d.date.slice(0, 10)}</span>
            </button>
          ))}
        {tab === 'journal' &&
          record.journal.map((j) => (
            <button key={j.slug} className={`node rd-entry ${pick === `j:${j.slug}` ? 'sel' : ''}`} onClick={() => setPick(`j:${j.slug}`)}>
              <span className="rd-t">{j.summary || j.slug}</span>
              <span className="rd-m">{j.date}{j.milestone ? ` · ${j.milestone}` : ''}</span>
            </button>
          ))}
        {tab === 'docs' &&
          DOCS.map((k) => (
            <button key={k} className={`node rd-entry ${pick === `doc:${k}` ? 'sel' : ''}`} onClick={() => setPick(`doc:${k}`)} disabled={!record[k]}>
              <span className="rd-t">{k}.md</span>
              <span className="rd-m">{record[k] ? (record[k]!.updated ? String(record[k]!.updated).slice(0, 10) : 'present') : 'not written yet'}</span>
            </button>
          ))}
        {record.unparsed.length > 0 && (
          <div className="rd-alert">{record.unparsed.length} file{record.unparsed.length > 1 ? 's' : ''} could not be parsed: {record.unparsed.map((u) => u.file).join(', ')}</div>
        )}
      </aside>

      <section className="rd-pane">
        {brief !== undefined && (
          <div className="rd-brief">
            <div className="rd-row">
              <button className="btn sm quiet" onClick={() => navigator.clipboard?.writeText(brief)}>Copy the brief</button>
              <button className="btn sm quiet" onClick={() => setBrief(undefined)}>Close</button>
              <span className="rd-c">Run it in a coding session; this app writes nothing itself.</span>
            </div>
            <Markdown text={brief} onLink={openSlug} />
          </div>
        )}
        {brief === undefined && !pick && (
          <div className="empty rd-empty">
            <h3>{record.project}: {record.learning.length} lessons, in the order they were needed.</h3>
            Each lesson opens on the lines of your own code where the idea lives, then explains it, then asks you two or three
            questions and gives you one thing to try. Lessons are ordered so that what a lesson needs comes before it.
            Start with the first unread one.
            <div className="rd-row">
              <button className="btn primary" onClick={() => setPick((ordered.find((l) => !read.has(l.slug)) ?? ordered[0])?.slug)}>Start</button>
            </div>

          </div>
        )}
        {brief === undefined && entry && pick && !pick.includes(':') && (
          <Lesson key={entry.slug} entry={entry} record={record} ordered={ordered} base={base} isRead={read.has(entry.slug)} onRead={(on) => markRead(entry.slug, on)} onPick={openSlug} onNext={goNext} />
        )}
        {brief === undefined && pick?.startsWith('d:') && (() => {
          const d = record.decisions.find((x) => `d:${x.slug}` === pick);
          return d ? (
            <article className="rd-read">
              <h2>{d.title}</h2>
              <div className="rd-meta rd-meta-under"><span className={`pill ${d.status === 'accepted' ? 'ok' : ''}`}>{d.status}</span><span className="rd-c">{d.date.slice(0, 10)}</span></div>
              <Markdown text={d.body} onLink={openSlug} />
            </article>
          ) : null;
        })()}
        {brief === undefined && pick?.startsWith('j:') && (() => {
          const j = record.journal.find((x) => `j:${x.slug}` === pick);
          return j ? (
            <article className="rd-read">
              <h2>{j.summary}</h2>
              <div className="rd-meta rd-meta-under"><span className="pill">{j.date}</span>{j.milestone && <span className="pill">{j.milestone}</span>}{j.reconstructed && <span className="pill" title={j.source ? `written from ${j.source}` : 'written after the fact'}>reconstructed</span>}{j.commits.length > 0 && <span className="rd-c">commits {j.commits.join(', ')}</span>}</div>
              <Markdown text={j.body} onLink={openSlug} />
              {j.learning.length > 0 && <div className="rd-row"><span className="rd-c">Lessons from this session</span>{j.learning.map((n) => <button key={n} className="rd-chip" onClick={() => openSlug(n)}>{n}</button>)}</div>}
              {j.next.length > 0 && <div className="rd-row"><span className="rd-c">Next</span>{j.next.map((n) => <span key={n} className="rd-chip">{n}</span>)}</div>}
            </article>
          ) : null;
        })()}
        {brief === undefined && pick?.startsWith('lib:') && (() => {
          const e = record.library.find((x) => `lib:${x.key}` === pick);
          if (!e) return null;
          const c = completeness(e);
          return (
            <article className="rd-read">
              <h2>{e.title}</h2>
              <div className="rd-meta rd-meta-under">
                <span className="pill">{e.type}</span>
                <span className="pill">{e.level}</span>
                <span className="rd-c">shared · {e.key}</span>
              </div>
              <p className="rd-lead">{e.summary}</p>
              <Slots c={c} />
              {e.verified ? (
                <p className="rd-c">The example was run: <code>{e.verified.command}</code>, exit {e.verified.exit}
                  {e.verified.version ? `, on ${e.verified.version}` : ''}{e.verified.at ? `, ${e.verified.at.slice(0, 10)}` : ''}.</p>
              ) : (
                <p className="rd-c">No example has been run for this entry.</p>
              )}
              {splitSlots(e.body).map((sec) => (
                <section key={sec.title}>
                  <h3>{sec.title}</h3>
                  <Markdown text={sec.body} onLink={openSlug} />
                </section>
              ))}
              {e.sources.length > 0 && (
                <>
                  <h3>Sources</h3>
                  <ul>
                    {e.sources.map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noreferrer">{src.title || src.url}</a>
                        {src.took ? ` — ${src.took}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          );
        })()}
        {brief === undefined && pick?.startsWith('doc:') && (() => {
          const k = pick.slice(4) as (typeof DOCS)[number];
          const d = record[k];
          return d ? (
            <article className="rd-read">
              <h2>{k}.md</h2>
              <Code code={JSON.stringify(d.data, null, 2)} language="json" />
              <Markdown text={d.body} onLink={openSlug} />
            </article>
          ) : null;
        })()}
      </section>
    </div>
  );
}

/** Which slots an entry holds. Three states, and the third is the point: a slot that cannot be
 *  filled here is a fact, not a to-do, and must not read as one. */
function Slots({ c }: { c: Completeness }) {
  return (
    <div className="rd-slots" aria-label={`${c.written} of ${c.fillable} slots written`}>
      {c.slots.map((s) => (
        <span
          key={s.slot}
          className={`rd-slot ${s.state}`}
          title={s.state === 'unfillable' ? `Cannot be filled here: ${s.reason}` : s.state === 'written' ? 'Written' : 'Not written yet'}
        >
          {SLOT_LABELS[s.slot]}
        </span>
      ))}
    </div>
  );
}

function Lesson({ entry, record, ordered, base, isRead, onRead, onPick, onNext }: { entry: LearningEntry; record: ProjectRecord; ordered: LearningEntry[]; base: string; isRead: boolean; onRead: (on: boolean) => void; onPick: (slug: string) => void; onNext: () => void }) {
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
  const chain = useMemo(() => chainTo(entry, ordered), [entry, ordered]);
  const [here, setHere] = useState<string>();

  // Which section the reader is in, for the table of contents. The observation band is a strip
  // near the top of the pane, and the first section in it wins, so a long section stays current
  // for as long as it is being read. `toc` is derived from `entry`, so that is the whole dep.
  useEffect(() => {
    const ids = toc.map((t) => `sec-${slugify(t)}`);
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const inBand = new Set<string>();
    const io = new IntersectionObserver(
      (rs) => {
        for (const r of rs) {
          if (r.isIntersecting) inBand.add(r.target.id);
          else inBand.delete(r.target.id);
        }
        const first = ids.find((id) => inBand.has(id));
        if (first) setHere(first);
      },
      { rootMargin: '-8% 0px -72% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [entry]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <article className="rd-read rd-lesson" ref={top}>
      <h2>{entry.title}</h2>
      <div className="rd-meta rd-meta-under">
        <span className="pill">{entry.type}</span>
        <span className="pill">{entry.level}</span>
        {entry.reconstructed && <span className="pill" title={entry.source ? `written from ${entry.source}` : 'written after the fact'}>reconstructed</span>}
        <span className="rd-c">{minutes(entry)} min read · introduced {entry.date.slice(0, 10)}</span>
      </div>
      <p className="rd-lead">{entry.summary}</p>

      {chain.length > 1 && (
        <nav className="rd-chain" aria-label="Prerequisite chain">
          <span className="rd-chain-lab">Read in order</span>
          {chain.map((l, i) => (
            <Fragment key={l.slug}>
              {i > 0 && <span className="rd-chain-sep" aria-hidden="true" />}
              {l.slug === entry.slug ? (
                <span className="rd-step" aria-current="step">{l.title}</span>
              ) : (
                <button className="rd-step" onClick={() => onPick(l.slug)}>{l.title}</button>
              )}
            </Fragment>
          ))}
        </nav>
      )}

      {(entry.prerequisites.length > 0 || entry.related.length > 0) && (
        <div className="rd-row">
          {entry.prerequisites.map((p) => (
            <button key={p} className="rd-chip" disabled={missing.includes(p)} onClick={() => onPick(p)} title={missing.includes(p) ? 'Not written yet' : 'Read this first'}>
              read first: {titleOf(record, p)}{missing.includes(p) ? ' · Not written yet' : ''}
            </button>
          ))}
          {entry.related.map((p) => (
            <button key={p} className="rd-chip" disabled={!record.learning.some((l) => l.slug === p)} onClick={() => onPick(p)}>
              see also: {titleOf(record, p)}{record.learning.some((l) => l.slug === p) ? '' : ' · Not written yet'}
            </button>
          ))}
        </div>
      )}

      <div className="rd-lesson-grid">
        {/* first in the source, so the collapsed row above the lesson reads in the order it looks */}
        <nav className="rd-toc" aria-label="On this page">
          <span className="rd-toc-h">On this page</span>
          {toc.map((t) => (
            <button
              key={t}
              aria-current={here === `sec-${slugify(t)}` ? 'location' : undefined}
              onClick={() => jumpTo(`sec-${slugify(t)}`)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="rd-body">
          {entry.files[0] && (
            <section id="sec-in-this-project">
              <h3>In this project</h3>
              {code === undefined && <p className="rd-c" aria-busy="true">Reading {entry.files[0]}…</p>}
              {code === null && <p className="rd-c">The file <code>{entry.files[0]}</code> is not in the project folder right now.</p>}
              {code && (
                <>
                  <div className="rd-codehead"><code>{code.path}</code><span className="rd-c">lines {code.start} to {code.start + code.lines.length - 1} of {code.totalLines}{code.anchorLine ? `, ${entry.anchor} on line ${code.anchorLine}` : ''}</span></div>
                  <Code code={code.lines.join('\n')} language={code.language} start={code.start} highlight={code.anchorLine} />
                </>
              )}
            </section>
          )}
          {sections.map((s) => (
            <section key={s.title} id={`sec-${slugify(s.title)}`}>
              <h3>{s.title}</h3>
              <Markdown text={s.body} onLink={onPick} />
            </section>
          ))}
          {entry.questions.length > 0 && (
            <section id="sec-check-yourself">
              <h3>Check yourself</h3>
              <p className="rd-c">Decide on your answer before you reveal one.</p>
              {entry.questions.map((q, i) => (
                <div key={i} className="rd-quiz">
                  <p className="rd-q">{q.q}</p>
                  {!revealed[i] && <button className="btn sm quiet" onClick={() => setRevealed({ ...revealed, [i]: true })}>Reveal the answer</button>}
                  {revealed[i] && <p className="rd-a">{q.a}</p>}
                </div>
              ))}
            </section>
          )}
          {entry.exercise && (
            <section id="sec-try-it">
              <h3>Try it</h3>
              <Markdown text={entry.exercise.task} onLink={onPick} />
              <div className="rd-row">
                {entry.exercise.hint && !hint && <button className="btn sm quiet" onClick={() => setHint(true)}>Show a hint</button>}
                {entry.exercise.solution && !solution && <button className="btn sm quiet" onClick={() => setSolution(true)}>Show the solution</button>}
              </div>
              {hint && entry.exercise.hint && <p className="rd-a">{entry.exercise.hint}</p>}
              {solution && entry.exercise.solution && <Code code={entry.exercise.solution.trim()} language={code?.language ?? 'javascript'} />}
            </section>
          )}
          <div className="rd-end">
            <button className={`btn ${isRead ? 'on' : ''}`} aria-pressed={isRead} onClick={() => onRead(!isRead)}>
              {isRead ? 'Read' : 'Mark as read'}
            </button>
            <button className="btn primary" onClick={onNext}>Next lesson</button>
          </div>
        </div>
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

/**
 * The chain of lessons this one sits at the end of: walk back through the first prerequisite that
 * was actually written, over the list `orderByPrerequisites` already put in reading order. A cycle
 * or a prerequisite nobody wrote ends the walk; the result reads root first, this lesson last.
 */
function chainTo(entry: LearningEntry, ordered: LearningEntry[]): LearningEntry[] {
  const byslug = new Map(ordered.map((l) => [l.slug, l]));
  const seen = new Set<string>([entry.slug]);
  const chain: LearningEntry[] = [entry];
  let cur = entry;
  for (;;) {
    const prev = cur.prerequisites.map((p) => byslug.get(p)).find((l): l is LearningEntry => !!l && !seen.has(l.slug));
    if (!prev) return chain;
    seen.add(prev.slug);
    chain.unshift(prev);
    cur = prev;
  }
}

function titleOf(record: ProjectRecord, slug: string): string {
  return record.learning.find((l) => l.slug === slug)?.title ?? slug;
}
function minutes(l: LearningEntry): number {
  const words = l.body.split(/\s+/).length + l.questions.reduce((n, q) => n + q.q.split(/\s+/).length + q.a.split(/\s+/).length, 0);
  return Math.max(1, Math.round(words / 180));
}
/** Jump to a section of the lesson; the glide goes away for a reader who asked for less motion. */
function jumpTo(id: string) {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
