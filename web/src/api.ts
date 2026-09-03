// The only two ways the browser talks to the server: fetch for lists, one WebSocket for a session.
import type { ClientMessage, ServerMessage, Session } from '@agenttrace/shared';

export async function fetchSessions(): Promise<Session[]> {
  const r = await fetch('/api/sessions');
  if (!r.ok) throw new Error(`sessions: ${r.status}`);
  return r.json();
}

export function openSocket(onMessage: (m: ServerMessage) => void, onState: (open: boolean) => void) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws: WebSocket | undefined;
  let wanted: string | undefined;
  let closed = false;

  const connect = () => {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      onState(true);
      if (wanted) send({ type: 'subscribe', sessionId: wanted });
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
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
      // Closing a socket that is still connecting makes the browser log a warning; wait for open.
      if (ws?.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws?.close());
      else ws?.close();
    },
  };
}
