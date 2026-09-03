// "Stack so far": every technology detected in the session, in the order it first appeared.
import type { Event } from '@agenttrace/shared';
import { STACK } from '@agenttrace/shared';

export function StackStrip({ events }: { events: Event[] }) {
  const hits = events.filter((e): e is Extract<Event, { kind: 'stack_detected' }> => e.kind === 'stack_detected');
  if (hits.length === 0) return null;
  return (
    <div className="stack" aria-label="Technologies detected">
      <span className="lab">Stack so far</span>
      {hits.map((h) => (
        <span key={h.tech} className={`badge ${STACK[h.tech]?.category ?? ''}`} title={`${STACK[h.tech]?.what ?? ''}\n\nseen in: ${h.evidence}`}>
          {h.tech}
        </span>
      ))}
    </div>
  );
}
