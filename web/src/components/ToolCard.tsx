import { useState } from 'react';
import type { AgentInfo, Event, ToolResultEvent } from '@agenttrace/shared';
import { gloss } from '@agenttrace/shared';

type Call = Extract<Event, { kind: 'tool_call' }>;

const LIMIT = 3000;

/** One tool call. The explanation shows by itself the first time a tool appears in the session; after that it is one click away. */
export function ToolCard({ call, result, agent, first }: { call: Call; result?: ToolResultEvent; agent?: AgentInfo; first: boolean }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(first);
  const [full, setFull] = useState(false);
  const input = (call.input ?? {}) as Record<string, any>;
  const g = gloss(call.name);
  const state = result ? (result.isError ? 'failed' : 'done') : 'running';
  const word = state === 'done' ? 'Done' : state === 'failed' ? 'Failed' : 'Running';

  return (
    <div className="card">
      <div className="line">
        <span className="name">{call.name}</span>
        <span className="arg" title={headline(call.name, input)}>{headline(call.name, input)}</span>
        <span className={`st ${state}`}>{word}</span>
        <button className={`why ${why ? 'on' : ''}`} onClick={() => setWhy(!why)} aria-pressed={why} aria-label="What this tool does" title="What this tool does">?</button>
        <button className={`open ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Show input and result" title="Show input and result">
          <span className="chev" aria-hidden />
        </button>
      </div>
      {why && (
        <div className="explain">
          {first && <span className="first">First time this tool appears in the session</span>}
          {g.what} <b>Look at:</b> {g.look}
        </div>
      )}
      {open && (
        <>
          <Input name={call.name} input={input} agent={agent} />
          {result && (
            <div className={`pane result ${result.isError ? 'err' : ''}`}>
              <div className="lab">{result.isError ? 'Error' : 'Result'}<span>{result.content.length.toLocaleString()} characters</span></div>
              <pre>{full || result.content.length <= LIMIT ? result.content : result.content.slice(0, LIMIT)}</pre>
              {!full && result.content.length > LIMIT && (
                <button className="more" onClick={() => setFull(true)}>Show all {result.content.length.toLocaleString()} characters</button>
              )}
            </div>
          )}
          {!result && <div className="notice">No result yet. It arrives on the next line the tool writes.</div>}
        </>
      )}
    </div>
  );
}

function headline(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'Bash': case 'PowerShell': return input.description || input.command || '';
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return short(input.file_path || input.notebook_path);
    case 'Grep': return `${input.pattern ?? ''}${input.path ? ' in ' + short(input.path) : ''}`;
    case 'Glob': return input.pattern ?? '';
    case 'Agent': return input.description ?? '';
    case 'Skill': return input.skill ?? '';
    case 'WebFetch': return input.url ?? '';
    case 'WebSearch': case 'ToolSearch': return input.query ?? '';
    case 'AskUserQuestion': return input.questions?.[0]?.question ?? '';
    default: {
      const v = Object.values(input).find((x) => typeof x === 'string');
      return typeof v === 'string' ? v : '';
    }
  }
}

function short(p?: string): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

function Input({ name, input, agent }: { name: string; input: Record<string, any>; agent?: AgentInfo }) {
  if (name === 'Edit' && typeof input.old_string === 'string') {
    return (
      <div className="pane diff">
        <div className="lab">{input.file_path}</div>
        <pre className="del">{input.old_string}</pre>
        <pre className="add">{input.new_string}</pre>
      </div>
    );
  }
  if (name === 'Write' && typeof input.content === 'string') {
    return (
      <div className="pane">
        <div className="lab">{input.file_path}<span>{input.content.length.toLocaleString()} characters</span></div>
        <pre>{input.content.length > LIMIT ? input.content.slice(0, LIMIT) + '\n…' : input.content}</pre>
      </div>
    );
  }
  if (name === 'Bash' || name === 'PowerShell') {
    return (
      <div className="pane">
        <div className="lab">Command</div>
        <pre>{input.command}</pre>
      </div>
    );
  }
  if (name === 'Agent') {
    return (
      <div className="pane">
        <div className="lab">Brief for {input.subagent_type ?? 'general-purpose'}{agent ? <span>transcript agent-{agent.agentId}</span> : null}</div>
        <pre>{input.prompt}</pre>
      </div>
    );
  }
  return (
    <div className="pane">
      <div className="lab">Input</div>
      <pre>{JSON.stringify(input, null, 2)}</pre>
    </div>
  );
}
