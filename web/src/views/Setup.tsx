// First-run and reference: where the app reads from, what is installed, and the two things a
// person has to do themselves: run the hook installer, and add the record instruction to a project.
import { useEffect, useState } from 'react';
import './read.css';

interface Status {
  claudeRoot: string;
  projectsDir: string;
  skillInstalled: boolean;
  hooksInstalled: boolean;
  hookInstaller: string;
  snippet: string;
  manifestExample: string;
  /** sessions and bytes are absent until the server's first archive sweep has counted them */
  archive: { sessions?: number; bytes?: number; root: string };
}

/** What a prune did: the sessions it deleted, the size it stopped at, and what it refused to touch. */
interface Prune {
  removed: { id: string; bytes: number }[];
  bytes: number;
  cap: number;
  keptOnlyCopies: number;
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

/**
 * A block the reader has to run or paste somewhere else, and the one control that gets it there
 * intact. The word swaps to "Copied" for 1.2 s; a refused clipboard leaves the word alone, so the
 * control never claims something that did not happen.
 */
function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
  };

  return (
    <div className="rd-cmd">
      <pre className="code">{text}</pre>
      <button className="btn sm quiet rd-copy" onClick={copy}>
        <span aria-live="polite">{copied ? <span className="rd-copied">Copied</span> : 'Copy'}</span>
      </button>
    </div>
  );
}

export function Setup({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Status | null>();
  const [busy, setBusy] = useState(false);
  const [minCap, setMinCap] = useState(100e6);
  const [noCap, setNoCap] = useState(true);
  const [capGb, setCapGb] = useState('5.0');
  const [capNote, setCapNote] = useState('');
  const [pruned, setPruned] = useState<Prune | null>(null);
  const [skillFailed, setSkillFailed] = useState(false);
  const load = () => fetch('/api/setup').then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null));
  const loadCap = () =>
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s) return;
        setMinCap(s.minCapBytes);
        setNoCap(s.archiveCapBytes === null);
        if (s.archiveCapBytes !== null) setCapGb(gb(s.archiveCapBytes));
      })
      .catch(() => undefined);
  useEffect(() => { load(); loadCap(); }, []);

  const installSkill = async () => {
    setBusy(true);
    setSkillFailed(false);
    try {
      const r = await fetch('/api/setup/skill', { method: 'POST' });
      if (r.ok) setSt(await r.json());
      else setSkillFailed(true);
    } catch {
      setSkillFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const saveCap = async () => {
    const bytes = noCap ? null : Math.round(Number(capGb) * 1e9);
    if (bytes !== null && !(bytes >= minCap)) {
      setCapNote(`The smallest limit is ${gb(minCap)} GB.`);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archiveCapBytes: bytes }) });
      setCapNote(r.ok ? (bytes === null ? 'Saved. The copy can grow as large as it needs to.' : 'Saved. The limit is applied the next time sessions are indexed.') : 'The server would not accept that limit.');
      if (r.ok) setPruned(null);
    } finally {
      setBusy(false);
    }
  };

  const pruneNow = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/archive/prune', { method: 'POST' });
      if (!r.ok) {
        setCapNote('Set a limit and save it first.');
        return;
      }
      setCapNote('');
      setPruned(await r.json());
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll">
      <article className="rd-read rd-setup">
        <div className="rd-head"><h2>Setup</h2><button className="btn sm quiet" onClick={onClose}>Back to sessions</button></div>
        {st === undefined && <p aria-busy="true">Checking…</p>}
        {st === null && <p>The server did not answer. Start it with <code>npx tsx server/src/index.ts</code> in the AgentTrace folder.</p>}
        {st && (
          <>
            <h3>1. Where sessions are read from</h3>
            <p>Transcripts are read from <code>{st.projectsDir}</code>. To read a different folder, start the server with <code>CLAUDE_CONFIG_DIR</code> set to the folder that holds <code>projects</code>.</p>

            <h3>Your copy of every session <span className="pill ok">{st.archive.sessions === undefined ? 'still counting' : `${st.archive.sessions} archived`}</span></h3>
            <p>The coding tool deletes transcripts after its retention period, 30 days unless changed. AgentTrace copies each session it indexes, with its helpers and file history, into <code>{st.archive.root}</code> ({st.archive.bytes === undefined ? 'its size is counted a few seconds after the server starts' : `${(st.archive.bytes / 1e6).toFixed(0)} MB`}), and keeps reading from that copy after the original is gone. Nothing you have opened here is lost to cleanup.</p>
            <p>You can set a size the copy is not allowed to pass. When it goes over, AgentTrace deletes whole sessions, the oldest first, and only ones whose original is still on this machine. A session whose original is already gone is never deleted, because this copy is the only one left, even if that leaves the folder over the size you set.</p>
            <div className="rd-cap">
              <label htmlFor="cap-gb">Keep it under</label>
              <input id="cap-gb" type="number" min={gb(minCap)} step="0.1" value={capGb} disabled={noCap} onChange={(e) => { setCapGb(e.target.value); setCapNote(''); }} />
              <span>GB</span>
              <button className={`btn sm ${noCap ? 'on' : ''}`} aria-pressed={noCap} onClick={() => { setNoCap(!noCap); setCapNote(''); }}>No limit</button>
              <button className="btn sm quiet" onClick={saveCap} disabled={busy}>Save</button>
              <button className="btn sm quiet" onClick={pruneNow} disabled={busy || noCap}>Prune now</button>
            </div>
            <p className="rd-note" role="status">
              {capNote}
              {pruned && ` Removed ${pruned.removed.length === 1 ? '1 session' : `${pruned.removed.length} sessions`} and freed ${gb(pruned.removed.reduce((n, r) => n + r.bytes, 0))} GB. The copy is now ${gb(pruned.bytes)} GB.`}
              {pruned && pruned.keptOnlyCopies > 0 && ` ${pruned.keptOnlyCopies === 1 ? '1 session was' : `${pruned.keptOnlyCopies} sessions were`} kept because this is the only copy of them.`}
              {pruned && pruned.bytes > pruned.cap && ` That is still ${gb(pruned.bytes - pruned.cap)} GB over the limit, and nothing more can go without losing a session for good.`}
            </p>

            <h3>2. Tool timings and permission events <span className={`pill ${st.hooksInstalled ? 'ok' : ''}`}>{st.hooksInstalled ? 'installed' : 'not installed'}</span></h3>
            <p>The transcript never records how long a tool took or when permission was asked. A small hook logger captures both. Install it once, from any terminal, then restart the coding tool:</p>
            <Cmd text={`node "${st.hookInstaller}"`} />
            <p>It backs up <code>settings.json</code> before changing it and prints the backup path. To undo, copy the backup back.</p>

            <h3>3. The learning record <span className={`pill ${st.skillInstalled ? 'ok' : ''}`}>{st.skillInstalled ? 'skill installed' : 'skill not installed'}</span></h3>
            <p>The Learn view reads notes the coding tool writes while it builds: one file per concept, decision and session. The format is a skill. Install it into <code>{st.claudeRoot}</code>:</p>
            {!st.skillInstalled && <div className="rd-row"><button className="btn primary" onClick={installSkill} disabled={busy}>{busy ? 'Installing…' : 'Install the agenttrace skill'}</button></div>}
            {st.skillInstalled && <p>Installed at <code>{st.claudeRoot}\skills\agenttrace\SKILL.md</code>. Reinstall after updating AgentTrace.</p>}
            {st.skillInstalled && <div className="rd-row"><button className="btn sm quiet" onClick={installSkill} disabled={busy}>{busy ? 'Installing…' : 'Reinstall'}</button></div>}
            {skillFailed && (
              <p className="rd-alert" role="status">Could not install the skill. Check that <code>skill/SKILL.md</code> is present in the AgentTrace checkout.</p>
            )}

            <h3>4. Turn it on for a project</h3>
            <p>First decide where that project's lessons should live. There are three usual answers:</p>
            <ul>
              <li><b>Inside the repository</b>, at <code>agenttrace/</code>. They travel with the code and get reviewed with it. They are public if the repository is public.</li>
              <li><b>A sibling folder</b>, at <code>../&lt;Project&gt;-notes/</code>. Private, still beside the code. One more folder to back up.</li>
              <li><b>One notes repository for everything</b>, at <code>&lt;path&gt;/&lt;Project&gt;/</code>. All projects in one private place, away from the code.</li>
            </ul>
            <p>Whatever documentation the project already keeps stays as it is and keeps being written; the record is added beside it, never merged with it. If the chosen folder already holds a file named like a record file in any letter case, the record goes in an <code>agenttrace</code> subfolder inside it. A repository built before the record existed can be backfilled from its history: run <code>/agenttrace backfill</code> in a session inside it while this app is running.</p>
            <p>Then put this file at the project's root, with the path you chose:</p>
            <Cmd text={`agenttrace.json\n${st.manifestExample}`} />
            <p>Then add this to the project's <code>CLAUDE.md</code> so every session follows the skill:</p>
            <Cmd text={st.snippet} />
            <p>From the next session on, the Learn view fills up as the project is built.</p>
          </>
        )}
      </article>
    </div>
  );
}
