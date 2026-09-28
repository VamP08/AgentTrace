// Start the server inside this process and measure what is attributable to it alone, whatever else
// the machine is doing: how long its event loop is held (every request waits that long), how many
// CPU-seconds it burns, and whether /api/projects — polled every ten seconds — gets answered.
//
//   npm run build && node scripts/loop-bench.mjs [seconds] [server dist folder]
//
// Stop any server on 4747 first; this one binds it. Reads the real ~/.claude, as the app does.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const secs = Number(process.argv[2] ?? 180);
const dist = resolve(process.argv[3] ?? join(fileURLToPath(import.meta.url), '..', '..', 'server', 'dist'));

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const win = monitorEventLoopDelay({ resolution: 10 });
win.enable();
const cpu0 = process.cpuUsage();
const { start } = await import(pathToFileURL(join(dist, 'index.js')).href);
await start(4747);

const t0 = performance.now();
const polls = [];
const windows = [];
const poll = setInterval(() => {
  const a = performance.now();
  fetch('http://127.0.0.1:4747/api/projects').then((r) => r.text()).then(() => polls.push(performance.now() - a), () => {});
}, 10_000);
// the longest hold in each five-second window, so a stall can be placed in time
const tick = setInterval(() => {
  const ms = win.max / 1e6;
  if (ms > 500) windows.push(`+${Math.round((performance.now() - t0) / 1000)}s:${ms.toFixed(0)}`);
  win.reset();
}, 5000);
await new Promise((r) => setTimeout(r, secs * 1000));
clearInterval(poll);
clearInterval(tick);

const cpu = process.cpuUsage(cpu0);
const ms = (ns) => (ns / 1e6).toFixed(0);
const done = polls.sort((a, b) => a - b);
console.log(`${dist}, ${secs} s`);
console.log(`  event loop held: p50 ${ms(loop.percentile(50))} ms, p99 ${ms(loop.percentile(99))} ms, max ${ms(loop.max)} ms`);
console.log(`  longest hold per 5 s window, over 500 ms: ${windows.join(' ') || 'none'}`);
console.log(`  server CPU: ${((cpu.user + cpu.system) / 1e6).toFixed(1)} s`);
console.log(`  /api/projects answered ${done.length} of ${Math.floor(secs / 10)}: ${done.map((x) => (x / 1000).toFixed(1) + 's').join(' ')}`);
process.exit(0);
