// Manual check: subscribe to a session and print what arrives, with timing.
// Usage: node server/test/ws-smoke.mjs <sessionId> [seconds]
import WebSocket from 'ws';

const sid = process.argv[2];
const seconds = Number(process.argv[3] ?? 12);
const ws = new WebSocket('ws://127.0.0.1:4747/ws');
const t0 = Date.now();
ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', sessionId: sid })));
ws.on('message', (m) => {
  const msg = JSON.parse(String(m));
  const n = msg.events?.length ?? msg.agents?.length ?? msg.sessions?.length ?? 0;
  const kinds = msg.events ? [...new Set(msg.events.map((e) => e.kind))].join(',') : '';
  console.log(`+${Date.now() - t0}ms ${msg.type} agent=${msg.agentId ?? '-'} n=${n} ${kinds}`);
});
ws.on('error', (e) => console.error('ws error', e.message));
setTimeout(() => {
  ws.close();
  process.exit(0);
}, seconds * 1000);
