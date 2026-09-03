// First-run and reference: where the app reads from, what is installed, and the two things a
// person has to do themselves: run the hook installer, and add the record instruction to a project.
import { useEffect, useState } from 'react';

interface Status {
  claudeRoot: string;
  projectsDir: string;
  skillInstalled: boolean;
  hooksInstalled: boolean;
  hookInstaller: string;
  snippet: string;
  manifestExample: string;
}

export function Setup({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Status | null>();
  const [busy, setBusy] = useState(false);
  const load = () => fetch('/api/setup').then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);

  const installSkill = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/setup/skill', { method: 'POST' });
      if (r.ok) setSt(await r.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll">
      <article className="doc setup">
        <div className="doc-h"><h2>Setup</h2><button className="btn sm" onClick={onClose}>Back to sessions</button></div>
        {st === undefined && <p aria-busy="true">Checking…</p>}
        {st === null && <p>The server did not answer. Start it with <code>npx tsx server/src/index.ts</code> in the AgentTrace folder.</p>}
        {st && (
          <>
            <h3>1. Where sessions are read from</h3>
            <p>Transcripts are read from <code>{st.projectsDir}</code>. To read a different folder, start the server with <code>CLAUDE_CONFIG_DIR</code> set to the folder that holds <code>projects</code>.</p>

            <h3>2. Tool timings and permission events <span className={`pill ${st.hooksInstalled ? 'ok' : ''}`}>{st.hooksInstalled ? 'installed' : 'not installed'}</span></h3>
            <p>The transcript never records how long a tool took or when permission was asked. A small hook logger captures both. Install it once, from any terminal, then restart the coding tool:</p>
            <pre className="code">node "{st.hookInstaller}"</pre>
            <p>It backs up <code>settings.json</code> before changing it and prints the backup path. To undo, copy the backup back.</p>

            <h3>3. The learning record <span className={`pill ${st.skillInstalled ? 'ok' : ''}`}>{st.skillInstalled ? 'skill installed' : 'skill not installed'}</span></h3>
            <p>The Learn view reads notes the coding tool writes while it builds: one file per concept, decision and session. The format is a skill. Install it into <code>{st.claudeRoot}</code>:</p>
            {!st.skillInstalled && <button className="btn primary" onClick={installSkill} disabled={busy}>{busy ? 'Installing…' : 'Install the agenttrace skill'}</button>}
            {st.skillInstalled && <p className="c">Installed at <code>{st.claudeRoot}\skills\agenttrace\SKILL.md</code>. Reinstall by clicking below after updating AgentTrace.</p>}
            {st.skillInstalled && <button className="btn sm" onClick={installSkill} disabled={busy}>{busy ? 'Installing…' : 'Reinstall'}</button>}

            <h3>4. Turn it on for a project</h3>
            <p>Choose where that project's notes should live. Put this file at the project's root, with your path:</p>
            <pre className="code">agenttrace.json{'\n'}{st.manifestExample}</pre>
            <p>Then add this to the project's <code>CLAUDE.md</code> so every session follows the skill:</p>
            <pre className="code">{st.snippet}</pre>
            <p>From the next session on, the Learn view fills up as the project is built.</p>
          </>
        )}
      </article>
    </div>
  );
}
