// The reader's progress: the one thing this app writes. An append-only log at
// ~/.claude/agenttrace/progress.jsonl, one event per line, and every number the Learn view shows is
// derived from it on load. See the decision `the-app-may-append-one-progress-log`.
//
// Practice follows two earlier decisions. Only an answer given seven or more days after the
// question was last seen counts as recall: answering straight after reading measures nothing. And
// the review schedule is SM-2, thirty lines and no dependency, stated as SM-2 rather than dressed up.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { questionId, type LearningEntry, type ReviewCard } from '@agenttrace/shared';

export { questionId };

export const RECALL_DAYS = 7;
const DAY = 86_400_000;

export type ProgressEvent =
  | { type: 'read' | 'unread'; project: string; slug: string; at: string }
  | { type: 'seen'; project: string; slug: string; qid: string; at: string }
  | { type: 'answered'; project: string; slug: string; qid: string; grade: number; recall: boolean; at: string };

export function progressPath(claudeRoot: string): string {
  return join(claudeRoot, 'agenttrace', 'progress.jsonl');
}

export function readProgress(claudeRoot: string): ProgressEvent[] {
  const file = progressPath(claudeRoot);
  if (!existsSync(file)) return [];
  const out: ProgressEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a line cut short by a crash costs that line, never the history
    }
  }
  return out;
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Validate one event from the page and append it. The page is trusted no further than the shape
 * of what it sends: known type, bounded strings, an integer grade. The time is the server's, and
 * whether an answer counts as recall is decided here from the log, never taken from the request.
 */
export function appendProgress(claudeRoot: string, body: unknown, now = new Date()): ProgressEvent | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!str(b.project, 200) || !str(b.slug, 200)) return 'project and slug are required';
  const at = now.toISOString();
  let ev: ProgressEvent;
  if (b.type === 'read' || b.type === 'unread') {
    ev = { type: b.type, project: b.project as string, slug: b.slug as string, at };
  } else if (b.type === 'seen' || b.type === 'answered') {
    if (!str(b.qid, 300)) return 'qid is required';
    if (b.type === 'seen') ev = { type: 'seen', project: b.project as string, slug: b.slug as string, qid: b.qid as string, at };
    else {
      if (!Number.isInteger(b.grade) || (b.grade as number) < 0 || (b.grade as number) > 5) return 'grade must be a whole number from 0 to 5';
      const last = lastExposure(readProgress(claudeRoot), b.project as string, b.qid as string);
      const recall = last !== undefined && now.getTime() - Date.parse(last) >= RECALL_DAYS * DAY;
      ev = { type: 'answered', project: b.project as string, slug: b.slug as string, qid: b.qid as string, grade: b.grade as number, recall, at };
    }
  } else return 'unknown event type';
  mkdirSync(dirname(progressPath(claudeRoot)), { recursive: true });
  appendFileSync(progressPath(claudeRoot), JSON.stringify(ev) + '\n');
  return ev;
}

/** When the reader last saw a question: the later of revealing it in a lesson and answering it. */
function lastExposure(events: ProgressEvent[], project: string, qid: string): string | undefined {
  let last: string | undefined;
  for (const e of events) if ((e.type === 'seen' || e.type === 'answered') && e.project === project && e.qid === qid && (!last || e.at > last)) last = e.at;
  return last;
}

type Card = ReviewCard;

/**
 * SM-2 over the recall answers only: an answer given too soon is logged but moves nothing. Quality
 * 3 and above passes; below resets the run. The interval is then floored at seven days from the
 * last exposure, because no answer sooner than that would count.
 */
export function schedule(events: ProgressEvent[], project: string, lessons: LearningEntry[]): Card[] {
  const cards: Card[] = [];
  for (const l of lessons) {
    l.questions.forEach((q) => {
      const qid = questionId(l.slug, q);
      const mine = events.filter((e) => (e.type === 'seen' || e.type === 'answered') && e.project === project && e.qid === qid);
      if (mine.length === 0) return; // never met in a lesson: nothing to recall yet
      let n = 0, interval = 0, ease = 2.5, lastRecall: string | undefined;
      for (const e of mine) {
        if (e.type !== 'answered' || !e.recall) continue;
        if (e.grade >= 3) {
          interval = n === 0 ? 1 : n === 1 ? 6 : Math.round(interval * ease);
          n += 1;
        } else {
          n = 0;
          interval = 1;
        }
        ease = Math.max(1.3, ease + (0.1 - (5 - e.grade) * (0.08 + (5 - e.grade) * 0.02)));
        lastRecall = e.at;
      }
      const lastSeen = mine.reduce((m, e) => (e.at > m ? e.at : m), mine[0].at);
      const bySm2 = lastRecall ? Date.parse(lastRecall) + interval * DAY : 0;
      const due = new Date(Math.max(bySm2, Date.parse(lastSeen) + RECALL_DAYS * DAY)).toISOString();
      cards.push({ qid, slug: l.slug, title: l.title, q: q.q, a: q.a, due, repetitions: n, interval, ease: Math.round(ease * 100) / 100, lastSeen });
    });
  }
  return cards.sort((a, b) => (a.due < b.due ? -1 : 1));
}

/** Lessons marked read, as of the last read or unread event for each. */
export function readSlugs(events: ProgressEvent[], project: string): string[] {
  const state = new Map<string, boolean>();
  for (const e of events) if ((e.type === 'read' || e.type === 'unread') && e.project === project) state.set(e.slug, e.type === 'read');
  return [...state].filter(([, on]) => on).map(([s]) => s);
}
