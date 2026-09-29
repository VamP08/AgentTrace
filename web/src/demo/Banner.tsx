// Preview build only: says what this page is before anyone mistakes it for their own sessions.
import { useState } from 'react';
import './demo.css';

const KEY = 'agenttrace-preview-banner';

export function Banner() {
  const [shown, setShown] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  if (!shown) return null;
  return (
    <div className="preview-banner" role="note">
      <p>
        <b>Online preview, made-up data.</b> LectureQA is a demo project built for this page. There is no server
        behind it and nothing you do is saved. To see your own Claude Code sessions, run AgentTrace on your machine:{' '}
        <a href="https://github.com/VamP08/AgentTrace" target="_blank" rel="noreferrer">github.com/VamP08/AgentTrace</a>
      </p>
      <button
        className="btn quiet"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, 'closed');
          } catch {
            // storage unavailable: closed until reload
          }
          setShown(false);
        }}
      >
        Close
      </button>
    </div>
  );
}
