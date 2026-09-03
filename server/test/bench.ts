import { parseFile } from '../src/parse.js';
const f = process.argv[2];
const t = performance.now();
const r = await parseFile(f, { sessionId: 'bench' });
const ms = Math.round(performance.now() - t);
const counts: Record<string, number> = {};
for (const e of r.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log(JSON.stringify({ ms, events: r.events.length, parseErrors: r.parseErrors, counts, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) }));
