// The only two ways the browser talks to the server: fetch for lists, one WebSocket for a session.
import type { ClientMessage, ServerMessage, Session } from '@agenttrace/shared';

export async function fetchSessions(): Promise<Session[]> {
  const r = await fetch('/api/sessions');
  if (!r.ok) throw new Error(`sessions: ${r.status}`);
  return r.json();
}

// The app wants exactly one live socket. `live` is the only one allowed to speak: any other
// socket — a retry that lost the race, or the first of the two the effect opens in development —
// stays silent, so a superseded socket closing can never report the connection as offline while
// its replacement is already connecting or open.
let live: WebSocket | undefined;

export function openSocket(onMessage: (m: ServerMessage) => void, onState: (open: boolean) => void) {
  if (import.meta.env.VITE_DEMO === '1') return previewSocket(onMessage, onState);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws: WebSocket | undefined;
  let wanted: string | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return; // a retry timer that outlived close() must not claim `live` back
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    ws = sock;
    live = sock;
    sock.onopen = () => {
      if (sock !== live) return sock.close();
      onState(true);
      if (wanted) send({ type: 'subscribe', sessionId: wanted });
    };
    sock.onmessage = (e) => {
      if (sock === live) onMessage(JSON.parse(e.data));
    };
    sock.onerror = () => {
      if (sock === live) sock.close(); // onclose follows and does the reporting
    };
    sock.onclose = () => {
      if (sock !== live) return;
      live = undefined;
      onState(false);
      if (!closed) setTimeout(connect, 1000);
    };
  };
  const send = (m: ClientMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  connect();
  return {
    subscribe(sessionId: string) {
      wanted = sessionId;
      send({ type: 'subscribe', sessionId });
    },
    close() {
      closed = true;
      const sock = ws;
      if (!sock) return;
      // Giving up the claim first is what keeps this close quiet: the onclose below sees a socket
      // that is no longer `live` and says nothing.
      if (live === sock) live = undefined;
      // Closing a socket that is still connecting makes the browser log a warning; wait for open.
      if (sock.readyState === WebSocket.CONNECTING) sock.addEventListener('open', () => sock.close());
      else sock.close();
    },
  };
}

/**
 * The online preview has no server to hold a socket open. A subscription is answered once, from the
 * same two responses the socket would have sent: the session's history and its helpers.
 */
function previewSocket(onMessage: (m: ServerMessage) => void, onState: (open: boolean) => void) {
  setTimeout(() => onState(true), 0);
  return {
    subscribe(sessionId: string) {
      Promise.all([fetch(`/api/sessions/${sessionId}/events`).then((r) => r.json()), fetch(`/api/sessions/${sessionId}/agents`).then((r) => r.json())])
        .then(([h, agents]) => {
          onMessage({ type: 'history', sessionId, events: h.events ?? [], parseErrors: h.parseErrors ?? 0 });
          onMessage({ type: 'agents', sessionId, agents: agents ?? [] });
        })
        .catch(() => {});
    },
    close() {},
  };
}
