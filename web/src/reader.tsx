// Plain view: the app for somebody who does not read JSON. It is on by default; turning it off
// shows every tool's input and result exactly as the transcript holds them, and the raw records.
import { createContext, useContext } from 'react';

export const PlainContext = createContext(true);
export const usePlain = () => useContext(PlainContext);

export function readPlain(): boolean {
  try {
    return localStorage.getItem('agenttrace-plain') !== 'off';
  } catch {
    return true;
  }
}
export function savePlain(on: boolean) {
  try {
    localStorage.setItem('agenttrace-plain', on ? 'on' : 'off');
  } catch {
    // storage unavailable: the choice lasts for this page
  }
}

/** Field names as words: file_path becomes "file path", subagentType becomes "subagent type". */
function words(key: string): string {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function describe(v: unknown): string {
  if (v === null || v === undefined) return 'nothing';
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join(', ') : `a list of ${v.length}`;
  if (typeof v === 'object') return `${Object.keys(v as object).length} more fields`;
  return String(v);
}

/** An object as one line per field, in words, with nested values summarised instead of printed as JSON. */
export function Fields({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <p className="fields-none">No input.</p>;
  return (
    <dl className="fields">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{words(k)}</dt>
          <dd>{describe(v).slice(0, 2000)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A result that is itself JSON, as fields; anything else is left as the text it is. */
export function asObject(text: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (!t.startsWith('{')) return undefined;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
