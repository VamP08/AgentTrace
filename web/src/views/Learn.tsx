// The record as a course. One lesson per concept: the reader's own code first, then the idea
// as a picture, the mechanism in steps, questions to commit to before revealing, and one
// exercise with a hint and a solution. Progress is a per-browser "read" mark, nothing more.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeWindow, Completeness, LearningEntry, LibraryEntry, ProjectRecord, ReviewCard } from '@agenttrace/shared';
import { COMPUTED_SLOTS, SLOT_LABELS, completeness, questionId, sections as splitSlots } from '@agenttrace/shared';
import { Markdown, Code } from '../components/Markdown';
import './read.css';

interface Props {
  /** the record endpoint for this repository, e.g. /api/projects/<id>/record */
  base: string;
  /** the repository's working copy, for the empty state */
  cwd: string;
  /** an entry somebody asked to open from elsewhere: a search result, a digest note */
  focus?: { kind: string; id: string; n: number };
}

const TYPES: LearningEntry['type'][] = ['library', 'tool', 'pattern', 'algorithm', 'math', 'architecture', 'design', 'security', 'testing', 'term'];
const SECTION_ORDER = ['In this project', 'What it is', 'Why here', 'The idea in one picture', 'How it works', 'Where to look', 'Check yourself', 'Try it', 'Go deeper'];
const DOCS = ['roadmap', 'stack', 'architecture', 'design', 'gaps'] as const;
const DOC_TITLE: Record<(typeof DOCS)[number], string> = { roadmap: 'Roadmap', stack: 'Stack', architecture: 'Architecture', design: 'Design', gaps: 'Known gaps' };

/** A date for a reader: the day, whatever form the frontmatter stored it in. */
function day(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

/**
 * The structured half of a record document, as a document. It used to be printed as the parsed
 * frontmatter in a JSON code block, line numbers and all — the roadmap's milestones and gates, and
 * the gap register, unreadable to anyone who does not read JSON. The shapes are the contract's.
 */
function RecordDoc({ k, data, onLink }: { k: (typeof DOCS)[number]; data: any; onLink: (slug: string) => void }) {
  const rows = (x: unknown): any[] => (Array.isArray(x) ? x.filter(Boolean) : []);
  if (k === 'roadmap') {
    return (
      <ul className="rd-docrows">
        {rows(data?.milestones).map((m) => (
          <li key={m.id}>
            <div className="rd-docrow-h">
              <b>{m.id}</b><span>{m.title}</span>
              <span className={`pill ${m.status === 'done' ? 'ok' : m.status === 'in-progress' ? 'live' : ''}`}>{m.status}</span>
            </div>
            {m.gate && <p><span className="rd-c">Done when: </span>{m.gate}</p>}
            {m.deferred && <p className="rd-c">Deferred: {m.deferred}</p>}
            {m.note && <p className="rd-c">Note: {m.note}</p>}
          </li>
        ))}
      </ul>
    );
  }
  if (k === 'stack') {
    return (
      <ul className="rd-docrows">
        {rows(data?.stack).map((s) => (
          <li key={s.name}>
            <div className="rd-docrow-h">
              <b>{s.name}</b>{s.version && <span className="rd-c">{s.version}</span>}<span className="pill">{s.category}</span>
              {s.learning && <button className="rd-chip" onClick={() => onLink(String(s.learning))}>lesson</button>}
            </div>
            {s.why && <p>{s.why}</p>}
            {s.instead_of && <p className="rd-c">Instead of: {s.instead_of}</p>}
          </li>
        ))}
      </ul>
    );
  }
  if (k === 'architecture') {
    return (
      <ul className="rd-docrows">
        {rows(data?.components).map((c) => (
          <li key={c.name}>
            <div className="rd-docrow-h"><b>{c.name}</b><code>{c.path}</code></div>
            {c.role && <p>{c.role}</p>}
            {rows(c.depends_on).length > 0 && <p className="rd-c">Depends on: {rows(c.depends_on).join(', ')}</p>}
          </li>
        ))}
      </ul>
    );
  }
  if (k === 'design') {
    const tokens = Object.entries(data?.tokens ?? {});
    return (
      <>
        {rows(data?.principles).length > 0 && <ul>{rows(data?.principles).map((p, i) => <li key={i}>{String(p)}</li>)}</ul>}
        {tokens.length > 0 && (
          <ul className="rd-docrows">
            {tokens.map(([name, value]) => <li key={name}><div className="rd-docrow-h"><b>{name}</b><code>{String(value)}</code></div></li>)}
          </ul>
        )}
      </>
    );
  }
  // gaps: open ones first, the most serious at the top; fixed ones stay listed, as the register asks
  const severity: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const rank = (g: any) => (g.status === 'open' ? 0 : 10) + (severity[g.severity] ?? 3);
  return (
    <ul className="rd-docrows">
      {rows(data?.gaps).sort((a, b) => rank(a) - rank(b)).map((g) => (
        <li key={g.id}>
          <div className="rd-docrow-h">
            <b>{g.id}</b><span>{g.title}</span>
            <span className={`pill ${g.status === 'fixed' ? 'ok' : g.severity === 'high' ? 'fail' : ''}`}>{g.status === 'fixed' ? 'fixed' : `open · ${g.severity}`}</span>
          </div>
          <p className="rd-c">Found {day(g.found)}{g.fixed ? ` · fixed ${day(g.fixed)}` : ''}{rows(g.files).length ? ` · ${rows(g.files).join(', ')}` : ''}</p>
        </li>
      ))}
    </ul>
  );
}

function readKey(project: string) {
  return `agenttrace-read:${project}`;
}
/** Read marks kept in the browser before the progress file existed; moved into the file once, then dropped. */
function legacyRead(project: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(readKey(project)) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * One event into the progress file, the app's only write. Sent as JSON on purpose: the server
 * refuses anything else, which is what stops another website writing to it.
 */
export function logProgress(ev: Record<string, unknown>): Promise<Response> {
  return fetch('/api/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) });
}

interface Progress {
  read: string[];
  cards: ReviewCard[];
  recallDays: number;
}

type LearnTab = 'learning' | 'review' | 'library' | 'stack' | 'decisions' | 'journal' | 'docs';

export function Learn({ base, cwd, focus }: Props) {
  const [record, setRecord] = useState<ProjectRecord | null | undefined>();
  const [pick, setPick] = useState<string>();
  const [type, setType] = useState<string>('all');
  const [tab, setTab] = useState<LearnTab>('learning');
  const [showBroken, setShowBroken] = useState(false);
  const [brief, setBrief] = useState<string>();
  const [read, setRead] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress>();

  // Progress comes from the server's file, so a cleared browser loses nothing. Marks still sitting
  // in this browser from before the file existed are moved into it once.
  const loadProgress = (project: string) =>
    fetch(`/api/progress?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (p: Progress | null) => {
        if (!p) return;
        const missing = legacyRead(project).filter((s) => !p.read.includes(s));
        for (const slug of missing) await logProgress({ type: 'read', project, slug });
        try { localStorage.removeItem(readKey(project)); } catch { /* nothing to drop */ }
        setRead(new Set([...p.read, ...missing]));
        setProgress(p);
      })
      .catch(() => {});

  useEffect(() => {
    setRecord(undefined);
    fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: (ProjectRecord & { present?: boolean }) | null) => {
        const rec = r && r.present === false ? null : r;
        setRecord(rec);
        if (rec) loadProgress(rec.project);
      })
      .catch(() => setRecord(null));
  }, [base]);

  const ordered = useMemo(() => (record ? orderByPrerequisites(record.learning) : []), [record]);
  /**
   * Every technology the project says it uses, and what the record has for it. Three states, and
   * the middle one is the point: an entry can explain a technology in general while nothing says
   * where this repository used it. Counting that as covered is what made a project with four
   * lessons look finished.
   */
  const stackRows = useMemo(() => {
    const rows: any[] = (record?.stack?.data as any)?.stack ?? [];
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return rows.filter((r) => r?.name).map((r) => {
      const n = norm(String(r.name));
      const entry = record?.library.find((e) => norm(e.slug) === n || (r.purl && e.purl === r.purl) || (r.learning && (e.key === r.learning || norm(e.slug) === norm(String(r.learning)))));
      const lesson = record?.learning.find((l) => (r.learning && l.slug === r.learning) || (entry && l.extends && (l.extends === entry.key || entry.key.endsWith(`/${l.extends}`))));
      return { name: String(r.name), category: String(r.category ?? 'other'), why: r.why ? String(r.why) : undefined, entry, lesson };
    });
  }, [record]);
  /**
   * The library entries this project actually draws on: one a lesson here overlays, or one a stack row
   * here names. The shared library holds every project's technologies, and listed whole it put HRMS's
   * Apache POI — "so a program can hand a government portal a workbook" — under AgentTrace.
   */
  const usedHere = useMemo(() => {
    const keys = new Set<string>();
    for (const e of record?.library ?? []) {
      if (record?.learning.some((l) => l.extends && (l.extends === e.key || e.key.endsWith(`/${l.extends}`)))) keys.add(e.key);
    }
    for (const r of stackRows) if (r.entry) keys.add(r.entry.key);
    return keys;
  }, [record, stackRows]);
  const [allLibrary, setAllLibrary] = useState(false);

  // Opened from elsewhere: go to the entry, whichever tab it lives on.
  useEffect(() => {
    if (!focus || !record) return;
    const { kind, id } = focus;
    setBrief(undefined);
    if (kind === 'lesson') { setTab('learning'); setType('all'); setPick(id); }
    else if (kind === 'decision') { setTab('decisions'); setPick(`d:${id}`); }
    else if (kind === 'journal') { setTab('journal'); setPick(`j:${id}`); }
    else if (kind === 'library') {
      const e = record.library.find((x) => x.key === id || x.key.endsWith(`/${id}`));
      setTab('library');
      if (e && !usedHere.has(e.key)) setAllLibrary(true);
      setPick(e ? `lib:${e.key}` : undefined);
    } else if (kind === 'stack') {
      const r = stackRows.find((x) => x.name.toLowerCase() === id.toLowerCase());
      if (r?.lesson) { setTab('learning'); setType('all'); setPick(r.lesson.slug); }
      else if (r?.entry) { setTab('library'); setPick(`lib:${r.entry.key}`); }
      else { setTab('stack'); setPick(undefined); }
    } else if (kind === 'gap') { setTab('docs'); setPick('doc:gaps'); }
    else if (kind === 'milestone') { setTab('docs'); setPick('doc:roadmap'); }
  }, [focus?.n, record]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = useMemo(() => ordered.filter((l) => type === 'all' || l.type === type), [ordered, type]);
  const now = new Date().toISOString();
  const dueNow = (progress?.cards ?? []).filter((c) => c.due <= now);
  const waiting = (progress?.cards ?? []).filter((c) => c.due > now);
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
    void logProgress({ type: on ? 'read' : 'unread', project: record.project, slug });
  };
  /** A question's answer was revealed in a lesson: the reader has now seen it, which starts its seven days. */
  const markSeen = (slug: string, qid: string) => {
    if (!record) return;
    void logProgress({ type: 'seen', project: record.project, slug, qid }).then(() => loadProgress(record.project));
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
        <code> agenttrace.json </code> was found at <code>{cwd}</code>. Open Setup in the bar above for the two files that turn
        it on; from the next session, lessons appear here.
      </div>
    );
  }

  const readCount = ordered.filter((l) => read.has(l.slug)).length;
  const docCount = DOCS.filter((k) => record[k]).length;
  const tabs: Record<LearnTab, [string, number]> = {
    learning: ['Lessons', record.learning.length],
    review: ['Review', dueNow.length],
    library: ['Library', usedHere.size],
    stack: ['Stack', stackRows.length],
    decisions: ['Decisions', record.decisions.length],
    journal: ['Journal', record.journal.length],
    docs: ['Plan & gaps', docCount],
  };
  // A section opens on its first entry, so the pane never goes on showing the course intro under
  // Decisions. Lessons keep the one being read; Review opens on the first question due.
  const firstOf = (t: LearnTab): string | undefined => {
    if (t === 'learning') return pick && !pick.includes(':') ? pick : undefined;
    if (t === 'review') return dueNow[0] && `r:${dueNow[0].qid}`;
    if (t === 'library') { const e = record.library.find((x) => allLibrary || usedHere.has(x.key)); return e && `lib:${e.key}`; }
    if (t === 'decisions') return record.decisions[0] && `d:${record.decisions[0].slug}`;
    if (t === 'journal') return record.journal[0] && `j:${record.journal[0].slug}`;
    if (t === 'docs') { const k = DOCS.find((x) => record[x]); return k && `doc:${k}`; }
    return undefined;
  };
  const openTab = (t: LearnTab) => {
    setTab(t);
    setBrief(undefined);
    setPick(firstOf(t));
  };

  return (
    <div className="rd-learn">
      <nav className="rd-nav" aria-label="Parts of the record">
        <div className="rd-nav-tabs" role="tablist">
          {(['learning', 'review', 'library', 'stack', 'decisions', 'journal', 'docs'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => openTab(t)}>
              {tabs[t][0]}<small>{tabs[t][1]}</small>
            </button>
          ))}
        </div>
        <div className="rd-nav-end">
          {record.unparsed.length > 0 && (
            <button className="rd-warnbtn" aria-expanded={showBroken} onClick={() => setShowBroken(!showBroken)}>
              {record.unparsed.length} record file{record.unparsed.length > 1 ? 's' : ''} could not be read
            </button>
          )}
          <button
            className="btn quiet"
            aria-pressed={brief !== undefined}
            onClick={() => {
              if (brief !== undefined) return setBrief(undefined);
              fetch(`${base.replace(/\/record$/, '/brief')}?format=md`)
                .then((r) => (r.ok ? r.text() : 'The brief could not be built.'))
                .then(setBrief);
            }}
          >
            {brief === undefined ? 'What the record is missing' : 'Close what is missing'}
          </button>
        </div>
      </nav>
      {showBroken && (
        <div className="rd-broken">
          <p>These files in the record have frontmatter that does not parse, so they are left out of every list here. Fixing the YAML at the top of each brings it back.</p>
          <ul>{record.unparsed.map((u) => <li key={u.file}><code>{u.file}</code></li>)}</ul>
        </div>
      )}
    <div className="split rd-split">
      <aside className="files rd-rail">
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
        {tab === 'review' && (
          <>
            {dueNow.map((c) => (
              <button key={c.qid} className={`node rd-entry ${pick === `r:${c.qid}` ? 'sel' : ''}`} onClick={() => setPick(`r:${c.qid}`)}>
                <span className="rd-t">{c.q}</span>
                <span className="rd-m">{c.title} · due</span>
              </button>
            ))}
            {waiting.length > 0 && (
              <p className="rd-note">
                {waiting.length} more waiting. The next comes back on {day(waiting[0].due)}.
              </p>
            )}
            {(progress?.cards.length ?? 0) === 0 && <p className="rd-note">Nothing to review yet.</p>}
          </>
        )}
        {tab === 'library' && (
          record.library.length === 0 ? (
            <div className="rd-note">
              No library is configured for this project. Add a <code>library</code> path to <code>agenttrace.json</code> and
              shared entries appear here, one per concept, reused by every project that uses it.
            </div>
          ) : (
            <>
              {usedHere.size === 0 && !allLibrary && (
                <div className="rd-note">Nothing in the shared library is used by this project yet.</div>
              )}
              {record.library.filter((e) => allLibrary || usedHere.has(e.key)).map((e) => {
                const c = completeness(e);
                return (
                  <button key={e.key} className={`node rd-entry ${pick === `lib:${e.key}` ? 'sel' : ''}`} onClick={() => setPick(`lib:${e.key}`)}>
                    <span className="rd-t">{e.title}</span>
                    <span className="rd-m">{e.type}{usedHere.has(e.key) ? '' : ' · from another project'} · {c.written === c.fillable ? 'complete' : `${c.written} of ${c.fillable} parts written`}</span>
                  </button>
                );
              })}
              {record.library.length > usedHere.size && (
                <div className="rd-row">
                  <button className="btn sm quiet" onClick={() => setAllLibrary(!allLibrary)} aria-pressed={allLibrary}>
                    {allLibrary ? 'Only what this project uses' : `Show the whole shared library (${record.library.length})`}
                  </button>
                </div>
              )}
            </>
          )
        )}
        {tab === 'stack' && (
          stackRows.length === 0 ? (
            <div className="rd-note">
              No <code>stack.md</code> in this record yet, so there is nothing to compare the lessons against.
            </div>
          ) : (
            <>
              <div className="rd-progress" aria-label="Technologies anchored in this project">
                <span>{stackRows.filter((r) => r.lesson).length} of {stackRows.length} have a lesson in this project</span>
                <i><b style={{ width: `${(stackRows.filter((r) => r.lesson).length / stackRows.length) * 100}%` }} /></i>
              </div>
              {stackRows.map((r) => (
                <button
                  key={r.name}
                  className={`node rd-entry ${pick === `lib:${r.entry?.key}` ? 'sel' : ''}`}
                  onClick={() => { if (r.lesson) { setTab('learning'); setPick(r.lesson.slug); } else if (r.entry) setPick(`lib:${r.entry.key}`); }}
                  disabled={!r.entry && !r.lesson}
                >
                  <span className="rd-t">{r.name}</span>
                  <span className="rd-m">
                    {r.lesson
                      ? `${r.category} · has a lesson here`
                      : r.entry
                        ? `${r.category} · explained in the library, no lesson here yet`
                        : `${r.category} · nothing written yet`}
                  </span>
                </button>
              ))}
            </>
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
              <span className="rd-t">{DOC_TITLE[k]}</span>
              <span className="rd-m">{record[k] ? `${k}.md${record[k]!.updated ? ` · ${day(record[k]!.updated)}` : ''}` : 'not written yet'}</span>
            </button>
          ))}
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
        {brief === undefined && !pick && tab === 'learning' && (
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
        {brief === undefined && !pick && tab === 'review' && (
          <div className="empty rd-empty">
            <h3>{dueNow.length > 0 ? `${dueNow.length} question${dueNow.length === 1 ? '' : 's'} due.` : 'Nothing is due.'}</h3>
            A question comes back {progress?.recallDays ?? 7} days after you last saw its answer in a lesson. Answering it then is
            what counts as remembering; answering sooner is practice, and is not counted.
            {(progress?.cards.length ?? 0) === 0 && ' Reveal an answer in any lesson and its question starts its seven days.'}
          </div>
        )}
        {brief === undefined && !pick && tab !== 'learning' && tab !== 'review' && (
          <div className="empty rd-empty">
            <h3>{tab === 'stack' ? 'Every technology this project uses.' : 'Nothing here yet.'}</h3>
            {tab === 'stack' ? 'Pick one on the left for its lesson here, or its entry in the shared library.' : 'This part of the record has no entries.'}
          </div>
        )}
        {brief === undefined && entry && pick && !pick.includes(':') && (
          <Lesson key={entry.slug} entry={entry} record={record} ordered={ordered} base={base} isRead={read.has(entry.slug)} onRead={(on) => markRead(entry.slug, on)} onPick={openSlug} onNext={goNext} onSeen={(qid) => markSeen(entry.slug, qid)} />
        )}
        {brief === undefined && pick?.startsWith('r:') && (() => {
          const c = progress?.cards.find((x) => `r:${x.qid}` === pick);
          return c ? (
            <Review
              key={c.qid}
              card={c}
              project={record.project}
              onDone={() => {
                const next = dueNow.find((x) => x.qid !== c.qid);
                void loadProgress(record.project);
                setPick(next ? `r:${next.qid}` : undefined);
              }}
            />
          ) : null;
        })()}
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
              {!usedHere.has(e.key) && (
                <p className="rd-c">Not used in {record.project}. This entry was written for another project and is shown from the shared library.</p>
              )}
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
              {(() => {
                // The computed slot: every lesson in this project that overlays this entry.
                // Assembled, never authored, so it cannot go stale against the record.
                const here = record.learning.filter((l) => l.extends === e.key || (l.extends && e.key.endsWith(`/${l.extends}`)));
                if (!here.length) return <p className="rd-c">No project has anchored this entry yet.</p>;
                return (
                  <section>
                    <h3>Where it shows up</h3>
                    <ul>
                      {here.map((l) => (
                        <li key={l.slug}>
                          <button className="rd-chip" onClick={() => { setTab('learning'); setPick(l.slug); }}>{record.project}</button>
                          {l.files[0] ? <>, <code>{l.files[0]}</code></> : null}
                          {l.anchor ? <> at <code>{l.anchor}</code></> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })()}
              {e.sources.length > 0 && (
                <>
                  <h3>Sources</h3>
                  <ul>
                    {e.sources.map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noreferrer">{src.title || src.url}</a>
                        {src.took ? `, ${src.took}` : ''}
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
              <h2>{DOC_TITLE[k]}</h2>
              <div className="rd-meta rd-meta-under"><span className="rd-c">{k}.md{d.updated ? ` · updated ${day(d.updated)}` : ''}</span></div>
              <RecordDoc k={k} data={d.data} onLink={openSlug} />
              <Markdown text={d.body} onLink={openSlug} />
            </article>
          ) : null;
        })()}
      </section>
    </div>
    </div>
  );
}

/**
 * One question brought back after its delay. Answer it in your head, reveal, then say how it went;
 * the grade is SM-2's quality score. The server decides whether it counted as recall, from the log,
 * and says so, so the reader is never told a same-day answer proved anything.
 */
function Review({ card, project, onDone }: { card: ReviewCard; project: string; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  const [result, setResult] = useState<{ recall: boolean } | string>();
  const grade = (g: number) =>
    logProgress({ type: 'answered', project, slug: card.slug, qid: card.qid, grade: g })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((ev) => setResult({ recall: ev.recall }))
      .catch(() => setResult('The answer could not be saved.'));
  return (
    <article className="rd-read">
      <div className="rd-meta rd-meta-under"><span className="rd-c">From the lesson: {card.title} · last seen {day(card.lastSeen)}</span></div>
      <h2>{card.q}</h2>
      <p className="rd-c">Answer it before you look.</p>
      {!shown && <div className="rd-row"><button className="btn primary" onClick={() => setShown(true)}>Show the answer</button></div>}
      {shown && <p className="rd-a">{card.a}</p>}
      {shown && result === undefined && (
        <div className="rd-row">
          <span className="rd-c">How did it go?</span>
          <button className="btn sm" onClick={() => grade(1)}>Forgot</button>
          <button className="btn sm" onClick={() => grade(3)}>Hard</button>
          <button className="btn sm" onClick={() => grade(4)}>Good</button>
          <button className="btn sm" onClick={() => grade(5)}>Easy</button>
        </div>
      )}
      {typeof result === 'string' && <p className="rd-alert">{result}</p>}
      {typeof result === 'object' && (
        <div className="rd-row">
          <span className="rd-c">{result.recall ? 'Recorded as recall.' : 'Saved, but too soon since you last saw it to count as recall.'}</span>
          <button className="btn sm primary" onClick={onDone}>Next</button>
        </div>
      )}
    </article>
  );
}

/** Which slots an entry holds. Three states, and the third is the point: a slot that cannot be
 *  filled here is a fact, not a to-do, and must not read as one. */
function Slots({ c }: { c: Completeness }) {
  return (
    <div className="rd-slots" aria-label={`${c.written} of ${c.fillable} slots written`}>
      {c.slots.map((s) => {
        // The computed slot is assembled from the projects that use the entry, so it is neither
        // written nor missing; showing it as empty would read as a job nobody has done.
        const computed = COMPUTED_SLOTS.includes(s.slot);
        const state = computed ? 'computed' : s.state;
        const title = computed
          ? 'Assembled from the projects that use this entry; never written by hand'
          : s.state === 'unfillable'
            ? `Cannot be filled here: ${s.reason}`
            : s.state === 'written'
              ? 'Written'
              : 'Not written yet';
        return (
          <span key={s.slot} className={`rd-slot ${state}`} title={title}>
            {SLOT_LABELS[s.slot]}
          </span>
        );
      })}
    </div>
  );
}

function Lesson({ entry, record, ordered, base, isRead, onRead, onPick, onNext, onSeen }: { entry: LearningEntry; record: ProjectRecord; ordered: LearningEntry[]; base: string; isRead: boolean; onRead: (on: boolean) => void; onPick: (slug: string) => void; onNext: () => void; onSeen: (qid: string) => void }) {
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
                  {!revealed[i] && <button className="btn sm quiet" onClick={() => { setRevealed({ ...revealed, [i]: true }); onSeen(questionId(entry.slug, q)); }}>Reveal the answer</button>}
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
