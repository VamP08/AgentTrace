// Slot arithmetic, shared because both halves need the same answer: the server to build a
// completion brief, the page to show which slots an entry holds. One implementation, no fs.
import { COMPUTED_SLOTS, REQUIRED_SLOTS, SLOTS, type Completeness, type SlotId, type SlotStatus } from './record.js';

/**
 * Headings that fill a body slot. Matched case-insensitively by prefix, so "Why here" from the
 * older lessons and "Why you would reach for it" from the newer ones both land on `why` without
 * either being rewritten. Migration by rendering rather than by editing every file.
 */
const HEADING_SLOTS: [RegExp, SlotId][] = [
  [/^what it is\b/i, 'what-it-is'],
  [/^why\b/i, 'why'],
  [/^the idea in one picture\b/i, 'picture'],
  [/^how it works\b/i, 'how-it-works'],
  [/^cheat ?sheet\b/i, 'cheat-sheet'],
  [/^common mistakes\b/i, 'common-mistakes'],
  [/^where it shows up\b/i, 'where-it-shows-up'],
  [/^go deeper\b/i, 'go-deeper'],
];

export interface Section {
  title: string;
  body: string;
  slot?: SlotId;
}

/** Split a body on level-2 headings. Order is preserved; a body with no headings is one section. */
export function sections(body: string): Section[] {
  const parts = body.split(/^## +/m);
  if (parts.length < 2) return body.trim() ? [{ title: '', body: body.trim() }] : [];
  return parts.slice(1).map((p) => {
    const nl = p.indexOf('\n');
    const title = (nl < 0 ? p : p.slice(0, nl)).trim();
    const text = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    return { title, body: text, slot: HEADING_SLOTS.find(([re]) => re.test(title))?.[1] };
  });
}

export function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** What a reader is told each slot is, in the order the slots are defined. */
export const SLOT_LABELS: Record<SlotId, string> = {
  'what-it-is': 'What it is',
  why: 'Why',
  picture: 'Diagram',
  'how-it-works': 'How it works',
  questions: 'Questions',
  objectives: 'Objectives',
  'cheat-sheet': 'Cheat sheet',
  'common-mistakes': 'Common mistakes',
  exercise: 'Exercise',
  verified: 'Example was run',
  sources: 'Sources',
  'go-deeper': 'Go deeper',
  'where-it-shows-up': 'Where it shows up',
};

/**
 * Which slots this entry holds, which are empty, and which it says cannot be filled here.
 * `where-it-shows-up` is computed from the projects that used the concept, so it is never counted
 * as missing — an entry nobody has anchored yet is not incomplete for that reason.
 */
export function completeness(entry: {
  body: string;
  objectives?: string[];
  questions?: unknown[];
  exercise?: unknown;
  sources?: unknown[];
  verified?: unknown;
  cannotFill?: Record<string, string>;
}): Completeness {
  const bySlot = new Map<SlotId, Section>();
  for (const s of sections(entry.body)) if (s.slot && !bySlot.has(s.slot)) bySlot.set(s.slot, s);

  const fromFrontmatter: Partial<Record<SlotId, number>> = {
    objectives: entry.objectives?.length ?? 0,
    questions: entry.questions?.length ?? 0,
    exercise: entry.exercise ? 1 : 0,
    sources: entry.sources?.length ?? 0,
    verified: entry.verified ? 1 : 0,
  };

  const cannot = entry.cannotFill ?? {};
  const slots: SlotStatus[] = SLOTS.map((slot) => {
    const reason = cannot[slot];
    const section = bySlot.get(slot);
    const count = fromFrontmatter[slot];
    const present = section ? true : count !== undefined ? count > 0 : false;
    if (present) return { slot, state: 'written', words: section ? words(section.body) : count };
    if (reason) return { slot, state: 'unfillable', reason };
    return { slot, state: 'empty' };
  });

  const authored = slots.filter((s) => !COMPUTED_SLOTS.includes(s.slot));
  const written = authored.filter((s) => s.state === 'written').length;
  const fillable = authored.filter((s) => s.state !== 'unfillable').length;
  const hasFloor = REQUIRED_SLOTS.every((r) => slots.find((s) => s.slot === r)?.state === 'written');
  return { slots, written, fillable, hasFloor, complete: written === fillable };
}
