// Search over the record. The two things worth testing are the ranking — a question like "why is
// chokidar here" has to land on the row that states the reason, not on every entry that says
// "why" — and the joins, because the chain symbol → lesson → decision → commit is the whole
// point of indexing the record rather than grepping it.
import { describe, it, expect } from 'vitest';
import { buildIndex, search, terms } from '../src/search.js';
import type { Decision, JournalEntry, LearningEntry, LibraryEntry, ProjectRecord } from '@agenttrace/shared';

function lesson(p: Partial<LearningEntry> & { slug: string }): LearningEntry {
  return {
    title: p.slug,
    summary: '',
    type: 'pattern',
    level: 'beginner',
    tags: [],
    files: [],
    prerequisites: [],
    related: [],
    date: '2026-09-01T00:00:00+05:30',
    updated: '2026-09-01T00:00:00+05:30',
    questions: [],
    objectives: [],
    sources: [],
    cannotFill: {},
    body: '',
    ...p,
  };
}

function decision(p: Partial<Decision> & { slug: string }): Decision {
  return { title: p.slug, status: 'accepted', date: '2026-09-01T00:00:00+05:30', tags: [], files: [], body: '', ...p };
}

function journal(p: Partial<JournalEntry> & { slug: string }): JournalEntry {
  return {
    date: '2026-09-01',
    started: '2026-09-01T10:00:00+05:30',
    summary: '',
    learning: [],
    decisions: [],
    commits: [],
    next: [],
    body: '',
    ...p,
  };
}

function libEntry(p: Partial<LibraryEntry> & { key: string }): LibraryEntry {
  return {
    slug: p.key.split('/').pop()!,
    title: p.key,
    summary: '',
    type: 'library',
    level: 'beginner',
    tags: [],
    prerequisites: [],
    related: [],
    objectives: [],
    questions: [],
    sources: [],
    cannotFill: {},
    date: '2026-09-01T00:00:00+05:30',
    updated: '2026-09-01T00:00:00+05:30',
    body: '',
    ...p,
  };
}

function record(project: string, p: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    project,
    root: `/records/${project}`,
    repoDir: `/code/${project}`,
    learning: [],
    decisions: [],
    journal: [],
    library: [],
    unparsed: [],
    ...p,
  };
}

const WATCHER = record('Watcher', {
  stack: {
    updated: '2026-09-01T00:00:00+05:30',
    body: '**Overview.** A file watcher.',
    data: {
      stack: [
        { name: 'chokidar', category: 'filesystem', version: '4.0.3', why: 'Cross-platform file watching that copes with Windows path quirks.', instead_of: 'fs.watch alone, which misses events on Windows.', learning: 'chokidar' },
        { name: 'vitest', category: 'test', why: 'Runs TypeScript without a build step.' },
      ],
    },
  },
  learning: [
    lesson({
      slug: 'chokidar',
      title: 'Watching a folder with chokidar',
      summary: 'Events for files that change under a folder',
      tags: ['filesystem'],
      files: ['server/src/tail.ts'],
      anchor: 'onChange',
      extends: 'pkg/npm/chokidar',
      session: 'sess-1',
      body: 'Chokidar watches a folder and calls back when a file changes.',
    }),
    lesson({ slug: 'byte-offset-tailing', title: 'Tailing a file by byte offset', files: ['server/src/tail.ts'], body: 'Read only the bytes past the offset.' }),
  ],
  decisions: [
    decision({ slug: 'poll-on-windows', title: 'Poll on Windows rather than trust native events', files: ['server/src/tail.ts'], session: 'sess-1', body: '**Why.** Native events are dropped under a network share.' }),
    decision({ slug: 'no-database', title: 'No database; the files are the source of truth', files: ['server/src/discover.ts'], body: '**Why.** A database would not have prevented the deletion.' }),
  ],
  journal: [
    journal({ slug: '2026-09-03-1042', summary: 'Tailer written and chokidar wired in', learning: ['chokidar', 'byte-offset-tailing'], decisions: ['poll-on-windows'], commits: ['a1b2c3d', 'e4f5a6b'], milestone: 'M1', session: 'sess-1' }),
  ],
  gaps: {
    updated: '2026-09-01T00:00:00+05:30',
    body: '**G1.** The tailer misses a file created and written within the same 50ms.\n\n**G2.** Something else.',
    data: { gaps: [{ id: 'G1', title: 'Tailer misses a fast create-and-write', severity: 'medium', status: 'open', found: '2026-09-03', files: ['server/src/tail.ts'] }] },
  },
  roadmap: {
    updated: '2026-09-01T00:00:00+05:30',
    body: '**Positioning.** A watcher.',
    data: { milestones: [{ id: 'M1', title: 'Live timeline', status: 'done', gate: 'Tool calls appear within 1s of landing on disk.' }] },
  },
  library: [libEntry({ key: 'pkg/npm/chokidar', title: 'chokidar', summary: 'Cross-platform file watching', body: 'One watcher over a folder tree.' })],
  libraryRoot: '/records/library',
});

const OTHER = record('Other', {
  learning: [lesson({ slug: 'watching', title: 'Watching files', extends: 'pkg/npm/chokidar', body: 'Used here too.' })],
  library: WATCHER.library,
  libraryRoot: '/records/library',
});

const index = buildIndex([WATCHER, OTHER]);

describe('terms', () => {
  it('keeps a dotted or underscored symbol whole', () => {
    expect(terms('chokidar.watch tool_use_id')).toEqual(['chokidar.watch', 'tool_use_id']);
  });
  it('drops punctuation around a word', () => {
    expect(terms('"byte offset!"')).toEqual(['byte', 'offset']);
  });
  it('drops the words that carry no question, since every entry says why', () => {
    expect(terms('why is chokidar here?')).toEqual(['chokidar']);
  });
  it('keeps a query made only of those words rather than searching for nothing', () => {
    expect(terms('why not')).toEqual(['why', 'not']);
  });
});

describe('search', () => {
  it('answers "why is chokidar here" with the row that states the reason', () => {
    const r = search(index, 'why is chokidar here');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].kind).toBe('stack');
    expect(r.hits[0].id).toBe('chokidar');
    expect(r.hits[0].snippet).toContain('Windows path quirks');
  });

  it('requires every term, so a word nobody wrote returns nothing', () => {
    expect(search(index, 'chokidar kubernetes').hits).toHaveLength(0);
  });

  it('finds a lesson by the symbol its anchor names', () => {
    const r = search(index, 'onChange');
    expect(r.hits.map((h) => h.id)).toContain('chokidar');
    expect(r.hits.find((h) => h.id === 'chokidar')!.matched).toContain('anchor');
  });

  it('finds an entry by a file path and by the file name alone', () => {
    expect(search(index, 'server/src/tail.ts').hits.map((h) => h.id)).toContain('byte-offset-tailing');
    expect(search(index, 'tail.ts').hits.map((h) => h.id)).toContain('byte-offset-tailing');
  });

  it('walks symbol to lesson to decision to commit', () => {
    const hit = search(index, 'onChange').hits.find((h) => h.id === 'chokidar')!;
    const decisions = hit.links.filter((l) => l.kind === 'decision').map((l) => l.id);
    expect(decisions).toContain('poll-on-windows');
    expect(decisions).not.toContain('no-database');
    const journals = hit.links.filter((l) => l.kind === 'journal').map((l) => l.id);
    expect(journals).toContain('2026-09-03-1042');
    expect(hit.links.filter((l) => l.kind === 'commit').map((l) => l.id)).toEqual(['a1b2c3d', 'e4f5a6b']);
    expect(hit.links.find((l) => l.kind === 'session')?.id).toBe('sess-1');
  });

  it('links a decision back to the lessons that name the same file', () => {
    const hit = search(index, 'poll-on-windows').hits[0];
    expect(hit.kind).toBe('decision');
    expect(hit.links.filter((l) => l.kind === 'lesson').map((l) => l.id).sort()).toEqual(['byte-offset-tailing', 'chokidar']);
  });

  it('indexes a shared library once and links it to every project that anchored it', () => {
    const lib = index.docs.filter((d) => d.kind === 'library');
    expect(lib).toHaveLength(1);
    const hit = search(index, 'pkg/npm/chokidar').hits.find((h) => h.kind === 'library')!;
    expect(hit.links.map((l) => `${l.project}:${l.id}`).sort()).toEqual(['Other:watching', 'Watcher:chokidar']);
  });

  it('keeps the shared library when a search is narrowed to one project', () => {
    const r = search(index, 'chokidar', 30, 'Other');
    expect(r.hits.map((h) => h.kind)).toContain('library');
    expect(r.hits.every((h) => h.project === 'Other' || h.project === '')).toBe(true);
  });

  it('finds a gap by its id and shows only its own paragraph', () => {
    const hit = search(index, 'G1').hits.find((h) => h.kind === 'gap')!;
    expect(hit.snippet).toContain('same 50ms');
    expect(hit.snippet).not.toContain('Something else');
  });

  it('puts the thing an id names above entries that merely mention it', () => {
    // as on the real record: the journal's title says G17, the gap's title does not, only its id does
    const r = search(buildIndex([record('Ids', {
      journal: [journal({ slug: '2026-09-28-2245', summary: 'G17 fixed by measurement' })],
      gaps: { updated: '', body: '**G17.** The server waits.', data: { gaps: [{ id: 'G17', title: 'The server blocks on its own archiving', severity: 'high', status: 'fixed', found: '2026-09-11', files: [] }] } },
    })]), 'G17');
    expect(r.hits[0]).toMatchObject({ kind: 'gap', id: 'G17' });
  });

  it('finds a milestone by its id and links the sessions that served it', () => {
    const hit = search(index, 'M1').hits.find((h) => h.kind === 'milestone')!;
    expect(hit.links.filter((l) => l.kind === 'journal').map((l) => l.id)).toEqual(['2026-09-03-1042']);
  });

  it('ranks an exact phrase above the same words scattered', () => {
    const r = search(index, 'byte offset');
    expect(r.hits[0].id).toBe('byte-offset-tailing');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(search(index, '   ').hits).toHaveLength(0);
    expect(search(index, '   ').indexed.projects).toEqual(['Other', 'Watcher']);
  });

  // The page opens a hit in the project whose record folder this names; an empty query asks for it.
  it('tells the page where each record lives, so a hit can be opened in its project', () => {
    expect(search(index, '').indexed.roots).toEqual({ Other: '/records/Other', Watcher: '/records/Watcher' });
  });
});
