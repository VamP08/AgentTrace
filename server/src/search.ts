// An index over the record, derived from the Markdown and thrown away when it changes.
//
// It is a flat list of documents held in memory, not a database. The whole corpus on this
// machine is 164 files and 1.1MB, and reading every one of them with gray-matter costs about
// 175ms; a stored index would have to be built, invalidated, migrated and recovered to save
// that, and the record on disk would stop being the only copy that matters. See the decision
// `search-index-is-derived-and-in-memory`.
import type {
  Decision,
  Hit,
  HitKind,
  JournalEntry,
  LearningEntry,
  LibraryEntry,
  Link,
  ProjectRecord,
  SearchResult,
} from '@agenttrace/shared';

/** One searchable field. `weight` is what a term found here is worth. */
interface Field {
  name: string;
  /** already lowercased */
  text: string;
  weight: number;
}

export interface Doc {
  kind: HitKind;
  /** the record it came from; '' for the shared library, which belongs to no project */
  project: string;
  id: string;
  title: string;
  summary: string;
  date?: string;
  links: Link[];
  fields: Field[];
  /** the text a snippet is cut from */
  body: string;
}

export interface Index {
  docs: Doc[];
  projects: string[];
  /** project name to record folder, which is how the page finds the project a hit belongs to */
  roots: Record<string, string>;
}

const W = { title: 10, id: 8, anchor: 6, tags: 5, why: 4, summary: 4, files: 4, body: 1 };

function field(name: string, weight: number, ...parts: (string | string[] | undefined)[]): Field | undefined {
  const text = parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLowerCase();
  return text ? { name, text, weight } : undefined;
}

function fields(...f: (Field | undefined)[]): Field[] {
  return f.filter((x): x is Field => x !== undefined);
}

function link(kind: Link['kind'], id: string, label: string, project?: string): Link {
  return project ? { kind, id, label, project } : { kind, id, label };
}

/** Drop links to the same thing twice, keeping the first, and cap the list so one card stays a card. */
function tidy(links: Link[], limit = 12): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const l of links) {
    const key = `${l.kind}:${l.project ?? ''}:${l.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

/** The paragraph of a many-item document that belongs to one item, e.g. `**G4.**` in gaps.md. */
function paragraphFor(body: string, id: string): string {
  const at = body.indexOf(`**${id}.**`);
  if (at < 0) return '';
  const rest = body.slice(at);
  const end = rest.indexOf('\n\n');
  return (end > 0 ? rest.slice(0, end) : rest).slice(0, 600);
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * Every document in one record, plus the links out of each. The links are the point: a symbol
 * found in a lesson leads to the decisions that named the same file, to the journal entry that
 * listed the lesson, and from there to the commits that session made.
 */
function docsFor(record: ProjectRecord, allRecords: ProjectRecord[]): Doc[] {
  const p = record.project;
  const out: Doc[] = [];

  // journal entries reached from a lesson slug, a decision slug and a milestone id
  const journalByLesson = new Map<string, JournalEntry[]>();
  const journalByDecision = new Map<string, JournalEntry[]>();
  const journalByMilestone = new Map<string, JournalEntry[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const j of record.journal) {
    for (const slug of j.learning) push(journalByLesson, slug, j);
    for (const slug of j.decisions) push(journalByDecision, slug, j);
    if (j.milestone) push(journalByMilestone, j.milestone, j);
  }

  // the file join: which lessons and which decisions name the same path
  const lessonsByFile = new Map<string, LearningEntry[]>();
  const decisionsByFile = new Map<string, Decision[]>();
  for (const l of record.learning) for (const f of l.files) push(lessonsByFile, f, l);
  for (const d of record.decisions) for (const f of d.files) push(decisionsByFile, f, d);

  // Commits are capped per entry: a card that lists a whole day of commits stops being a card, and
  // the journal link beside them is where the rest are.
  const journalLinks = (entries: JournalEntry[] | undefined, maxCommits = 3): Link[] =>
    (entries ?? []).flatMap((j) => [
      link('journal', j.slug, j.summary || j.date, p),
      ...j.commits.slice(0, maxCommits).map((sha) => link('commit', sha, `${sha} · ${j.date}`)),
    ]);

  for (const l of record.learning) {
    const viaFiles = l.files.flatMap((f) => [
      link('file', f, f),
      ...(decisionsByFile.get(f) ?? []).map((d) => link('decision', d.slug, d.title, p)),
    ]);
    out.push({
      kind: 'lesson',
      project: p,
      id: l.slug,
      title: l.title,
      summary: l.summary,
      date: l.updated || l.date,
      body: l.body,
      links: tidy([
        ...(l.extends ? [link('library', l.extends, l.extends)] : []),
        ...viaFiles,
        ...journalLinks(journalByLesson.get(l.slug)),
        ...l.prerequisites.map((s) => link('lesson', s, s, p)),
        ...l.related.map((s) => link('lesson', s, s, p)),
        ...(l.session ? [link('session', l.session, 'the session that wrote it')] : []),
      ]),
      fields: fields(
        field('title', W.title, l.title),
        field('id', W.id, l.slug, l.extends),
        field('anchor', W.anchor, l.anchor),
        field('tags', W.tags, l.tags, l.type, l.level, l.unit),
        field('summary', W.summary, l.summary, l.objectives),
        field('files', W.files, l.files, l.files.map(baseName)),
        field('body', W.body, l.body, l.questions.flatMap((q) => [q.q, q.a])),
      ),
    });
  }

  for (const d of record.decisions) {
    out.push({
      kind: 'decision',
      project: p,
      id: d.slug,
      title: d.title,
      summary: d.status === 'superseded' ? 'superseded' : 'accepted',
      date: d.date,
      body: d.body,
      links: tidy([
        ...d.files.flatMap((f) => [link('file', f, f), ...(lessonsByFile.get(f) ?? []).map((l) => link('lesson', l.slug, l.title, p))]),
        ...journalLinks(journalByDecision.get(d.slug)),
        ...(d.supersedes ? [link('decision', d.supersedes, `supersedes ${d.supersedes}`, p)] : []),
        ...(d.session ? [link('session', d.session, 'the session that decided it')] : []),
      ]),
      fields: fields(
        field('title', W.title, d.title),
        field('id', W.id, d.slug),
        field('tags', W.tags, d.tags, d.status),
        field('files', W.files, d.files, d.files.map(baseName)),
        field('body', W.body, d.body),
      ),
    });
  }

  for (const j of record.journal) {
    out.push({
      kind: 'journal',
      project: p,
      id: j.slug,
      title: j.summary || `Session of ${j.date}`,
      summary: [j.milestone, j.date].filter(Boolean).join(' · '),
      date: j.started || j.date,
      body: j.body,
      links: tidy([
        ...j.learning.map((s) => link('lesson', s, s, p)),
        ...j.decisions.map((s) => link('decision', s, s, p)),
        ...j.commits.map((sha) => link('commit', sha, sha)),
        ...(j.session ? [link('session', j.session, 'the session')] : []),
      ]),
      fields: fields(
        field('title', W.title, j.summary),
        field('id', W.id, j.slug, j.milestone),
        field('tags', W.tags, j.next),
        field('summary', W.summary, j.learning, j.decisions),
        field('body', W.body, j.body, j.commits),
      ),
    });
  }

  for (const s of record.stack?.data?.stack ?? []) {
    if (!s?.name) continue;
    const lib = record.library.find((e) => e.key.endsWith(`/${s.name}`) || e.slug === s.name || e.purl?.endsWith(`/${s.name}`));
    out.push({
      kind: 'stack',
      project: p,
      id: s.name,
      title: s.name + (s.version ? ` ${s.version}` : ''),
      summary: s.why ?? '',
      body: [s.why, s.instead_of ? `Instead of: ${s.instead_of}` : ''].filter(Boolean).join(' '),
      links: tidy([
        ...(s.learning ? [link('lesson', s.learning, s.learning, p)] : []),
        ...(lib ? [link('library', lib.key, lib.title)] : []),
      ]),
      fields: fields(
        field('title', W.title, s.name),
        field('id', W.id, s.name, s.learning),
        field('tags', W.tags, s.category, s.version),
        field('why', W.why, s.why, s.instead_of),
      ),
    });
  }

  for (const g of record.gaps?.data?.gaps ?? []) {
    if (!g?.id) continue;
    const detail = paragraphFor(record.gaps?.body ?? '', g.id);
    out.push({
      kind: 'gap',
      project: p,
      id: g.id,
      title: g.title ?? g.id,
      summary: [g.severity, g.status, g.fixed ? `fixed ${g.fixed}` : ''].filter(Boolean).join(' · '),
      date: g.fixed || g.found,
      body: detail,
      links: tidy(
        (g.files ?? []).flatMap((f) => [
          link('file', f, f),
          ...(lessonsByFile.get(f) ?? []).map((l) => link('lesson', l.slug, l.title, p)),
          ...(decisionsByFile.get(f) ?? []).map((d) => link('decision', d.slug, d.title, p)),
        ]),
      ),
      fields: fields(
        field('title', W.title, g.title),
        field('id', W.id, g.id),
        field('tags', W.tags, g.severity, g.status),
        field('files', W.files, g.files, (g.files ?? []).map(baseName)),
        field('body', W.body, detail),
      ),
    });
  }

  for (const m of record.roadmap?.data?.milestones ?? []) {
    if (!m?.id) continue;
    out.push({
      kind: 'milestone',
      project: p,
      id: m.id,
      title: `${m.id} · ${m.title ?? ''}`.trim(),
      summary: m.status ?? '',
      body: m.gate ?? '',
      links: tidy(journalLinks(journalByMilestone.get(m.id))),
      fields: fields(
        field('title', W.title, m.id, m.title),
        field('id', W.id, m.id),
        field('tags', W.tags, m.status),
        field('body', W.body, m.gate),
      ),
    });
  }

  // The shared library belongs to no project, so it is indexed once, from the first record that
  // configures it, and its links are the projects that anchored it.
  if (record.libraryRoot && !allRecords.some((r) => r !== record && r.libraryRoot === record.libraryRoot && r.project < record.project)) {
    for (const e of record.library) out.push(libraryDoc(e, allRecords));
  }
  return out;
}

function libraryDoc(e: LibraryEntry, allRecords: ProjectRecord[]): Doc {
  const anchored = allRecords.flatMap((r) =>
    r.learning
      .filter((l) => l.extends && (l.extends === e.key || e.key.endsWith(`/${l.extends}`)))
      .map((l) => link('lesson', l.slug, `${r.project}: ${l.title}`, r.project)),
  );
  return {
    kind: 'library',
    project: '',
    id: e.key,
    title: e.title,
    summary: e.summary,
    date: e.updated || e.date,
    body: e.body,
    links: tidy(anchored),
    fields: fields(
      field('title', W.title, e.title),
      field('id', W.id, e.key, e.slug, e.purl),
      field('tags', W.tags, e.tags, e.type, e.level),
      field('summary', W.summary, e.summary, e.objectives),
      field('body', W.body, e.body, e.questions.flatMap((q) => [q.q, q.a])),
    ),
  };
}

export function buildIndex(records: ProjectRecord[]): Index {
  const sorted = [...records].sort((a, b) => a.project.localeCompare(b.project));
  return {
    docs: sorted.flatMap((r) => docsFor(r, sorted)),
    projects: sorted.map((r) => r.project),
    roots: Object.fromEntries(sorted.map((r) => [r.project, r.root])),
  };
}

// Every term has to match, which is right for a corpus this small — but only once the words that
// carry no question are gone. "why is chokidar here" is the question the milestone is measured on,
// and every one of those four words except one appears in every entry in the record.
const STOP = new Set(
  'the a an and or but if then than that this these those there here is are was were be been being am do does did doing have has had of in on at to for from by with about into over under again as it its his her their our your my me we us you i he she they them what which who whom when where how why can could should would will shall may might must not no so such own too very just also'.split(' '),
);

/** Words to look for. Split on whitespace only, so `chokidar.watch` and `tool_use_id` stay whole. */
export function terms(q: string): string[] {
  const all = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w@/.#-]+|[^\w@/.#-]+$/g, ''))
    .filter((t) => t.length > 1);
  const kept = all.filter((t) => !STOP.has(t));
  // a query made only of those words is still a query: search it as typed rather than return nothing
  return kept.length ? kept : all;
}

function snippet(doc: Doc, first: string): string {
  const text = (doc.body || doc.summary).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const at = text.toLowerCase().indexOf(first);
  if (at < 0) return text.slice(0, 180) + (text.length > 180 ? '…' : '');
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + first.length + 110);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/**
 * Every term must appear somewhere, and each term scores the weight of the strongest field it
 * appears in. An `AND` is the right default for a record this size: a question like "why is
 * chokidar here" should not return everything that says "why".
 */
function scoreDoc(doc: Doc, ts: string[], phrase: string): { score: number; matched: string[] } | undefined {
  let score = 0;
  const matched = new Map<string, number>();
  for (const t of ts) {
    let best: Field | undefined;
    for (const f of doc.fields) if (f.text.includes(t) && (!best || f.weight > best.weight)) best = f;
    if (!best) return undefined;
    score += best.weight;
    matched.set(best.name, Math.max(matched.get(best.name) ?? 0, best.weight));
  }
  // a multi-word query that appears intact is a much better answer than the same words scattered
  if (ts.length > 1) for (const f of doc.fields) if (f.text.includes(phrase)) score += f.weight;
  // Typing a thing's own id — G17, M9, a slug — means that thing. Without this a journal entry whose
  // title mentions G17 outranked the gap named G17, since a title outweighs an id.
  if (doc.id.toLowerCase() === phrase) score += 20;
  // A stack row is one line that is entirely "what this is and why it is here", so when it matches
  // at all it is the shortest true answer. A lesson teaches the same thing at length and comes
  // next. A journal entry only mentions the thing in passing, and gets no bump.
  if (doc.kind === 'stack') score += 4;
  else if (doc.kind === 'lesson' || doc.kind === 'library') score += 2;
  return { score, matched: [...matched.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) };
}

export function search(index: Index, q: string, limit = 30, project?: string): SearchResult {
  const t0 = Date.now();
  const ts = terms(q);
  const phrase = q.toLowerCase().trim();
  const pool = project ? index.docs.filter((d) => d.project === project || d.kind === 'library') : index.docs;
  const hits: Hit[] = [];
  if (ts.length) {
    for (const doc of pool) {
      const s = scoreDoc(doc, ts, phrase);
      if (!s) continue;
      hits.push({
        kind: doc.kind,
        project: doc.project,
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        date: doc.date,
        score: s.score,
        matched: s.matched,
        snippet: snippet(doc, ts[0]),
        links: doc.links,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0) || a.title.localeCompare(b.title));
  return {
    q,
    hits: hits.slice(0, limit),
    total: hits.length,
    tookMs: Date.now() - t0,
    indexed: { docs: pool.length, projects: index.projects, roots: index.roots },
  };
}
