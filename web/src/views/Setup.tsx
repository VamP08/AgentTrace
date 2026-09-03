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
  archive: { sessions: number; bytes: number; root: string };
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

            <h3>Your copy of every session <span className="pill ok">{st.archive.sessions} archived</span></h3>
            <p>The coding tool deletes transcripts after its retention period, 30 days unless changed. AgentTrace copies each session it indexes, with its helpers and file history, into <code>{st.archive.root}</code> ({(st.archive.bytes / 1e6).toFixed(0)} MB), and keeps reading from that copy after the original is gone. Nothing you have opened here is lost to cleanup.</p>

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
            <p>First decide where that project's lessons should live. There are three usual answers:</p>
            <ul>
              <li><b>Inside the repository</b>, at <code>agenttrace/</code>. They travel with the code and get reviewed with it. They are public if the repository is public.</li>
              <li><b>A sibling folder</b>, at <code>../&lt;Project&gt;-notes/</code>. Private, still beside the code. One more folder to back up.</li>
              <li><b>One notes repository for everything</b>, at <code>&lt;path&gt;/&lt;Project&gt;/</code>. All projects in one private place, away from the code.</li>
            </ul>
            <p className="now-p">Whatever documentation the project already keeps stays as it is and keeps being written; the record is added beside it, never merged with it. If the chosen folder already holds a file named like a record file in any letter case, the record goes in an <code>agenttrace</code> subfolder inside it. A repository built before the record existed can be backfilled from its history: run <code>/agenttrace backfill</code> in a session inside it while this app is running.</p>
            <p>Then put this file at the project's root, with the path you chose:</p>
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
