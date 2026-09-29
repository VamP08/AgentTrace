// A question's identity, shared by the page (which logs that it was seen) and the server (which
// schedules it), so the two can never disagree about which question an answer belongs to.

/**
 * The record's own `id` when it gives one, else a hash of the question's text. Reordering a
 * lesson's questions never moves an answer onto a different question; rewording one makes it a
 * new question, which it is.
 */
export function questionId(slug: string, q: { q: string; id?: string }): string {
  if (q.id) return `${slug}#${q.id}`;
  // FNV-1a, 32 bits: synchronous and the same in the browser and in Node
  let h = 0x811c9dc5;
  for (let i = 0; i < q.q.length; i++) {
    h ^= q.q.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${slug}#${h.toString(16).padStart(8, '0')}`;
}

/** A review card: one question met in a lesson, and when it may next be asked. */
export interface ReviewCard {
  qid: string;
  slug: string;
  title: string;
  q: string;
  a: string;
  due: string;
  repetitions: number;
  interval: number;
  ease: number;
  lastSeen: string;
}
