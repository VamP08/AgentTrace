# AgentTrace

A local web app that shows a Claude Code session as it happens, and explains it.

It reads the transcript files Claude Code already writes to disk, tails them live, and renders
each session as turns: what you asked, what the model did in answer, every tool call with a
plain-language line the first time that tool appears, the files that changed with a diff for
every version, the helpers that were spawned with their briefs and reports, and what each turn
cost in tokens. No model runs inside the app. Everything it explains was written down at build
time, by hand or by the coding session itself through a skill.

## What it reads

| Source | Where | What it gives |
|---|---|---|
| Transcripts | `~/.claude/projects/<project>/<session>.jsonl` | Turns, tool calls, results, token usage |
| Helper transcripts | `<session>/subagents/agent-*.jsonl` | Each helper's own work, joined to its brief |
| File history | `~/.claude/file-history/<session>/` | Every version of every file the session edited |
| Hook log | `~/.claude/agenttrace/hooks/<session>.jsonl` | Tool durations, permission requests, notifications (after installing the hooks) |
| Archive | `~/.claude/agenttrace/archive/` | AgentTrace's own copy of every session it has indexed, read once the coding tool's cleanup has removed the original |
| Git | the repositories the session touched | Commits made during the session, joined to turns by time |
| The record | a folder named by `agenttrace.json` | Concepts, decisions and journal entries the session wrote while building |

## Run it

Requires Node 20 or later.

```
npm install
npx tsx server/src/index.ts        # API and live stream on http://127.0.0.1:4747
cd web && npx vite                  # page on http://127.0.0.1:4748
```

Open `http://127.0.0.1:4748`. The sidebar lists every session on the machine, live ones first.

The server binds to the loopback address only, sends no cross-origin headers, and refuses
requests whose Host is not localhost.

## Views

- **Turns.** A Now panel with the latest request, the model's latest line, the running tool and
  its explanation; then each turn as a chapter with counts, folded until opened. Commits made
  during a turn appear inside it.
- **Files.** Every file the session touched, every backed-up version, and the line diff between
  a version and the one before it, or between the last backup and the file on disk now.
- **Helpers.** Each subagent with the brief it received, its transcript, and its report back.
- **Context.** Per turn: the size of the context the model saw, tokens written, replies, and
  everything that entered the context without you typing it.
- **Learn.** The project's record as a learning path: concepts by type, decisions, journal,
  and the project documents.

## The record

The Learn view depends on a folder of Markdown files with YAML frontmatter that a coding
session is instructed to keep. The format is defined in `skill/SKILL.md`. The Setup screen in
the app installs the skill, prints the `agenttrace.json` to place at a project's root, and the
paragraph to add to that project's `CLAUDE.md`.

The record sits beside whatever documentation a project already keeps and never replaces it:
the skill writes only inside the folder named in `agenttrace.json`, and puts the record in an
`agenttrace` subfolder when that folder already holds files with the same names.

A repository built before the record existed can be backfilled. `GET /api/dossier?cwd=<repo>`
returns a Markdown dossier of what the app knows about it: which evidence exists, the archived
sessions that worked there, the technologies seen, every commit on the default branch with the
session it belongs to, and the commit messages that state a reason. The skill's backfill
section turns that into a record, writes only the documents the evidence supports, and marks
each one `reconstructed`.

## Hooks

`hooks/install-settings.mjs` registers a small logger for every Claude Code hook event and
wraps the status line command. It backs up `settings.json` first and prints the backup path.
The logger appends one JSON line per event to `~/.claude/agenttrace/hooks/<session>.jsonl` and
never blocks the session.

## Tests

```
npx vitest run --root server
```

Parser, discovery, tailer, file history, stack detection, record reader, hook log and git are
covered. The parser is also timed against a 25 MB real session.

## Status

Built and verified on Windows against real sessions. macOS and Linux paths for the scratchpad
and MCP logs are designed but not yet tested. The status-line wrapper has not been confirmed
from a terminal session. The design pass over the views is still ahead.
