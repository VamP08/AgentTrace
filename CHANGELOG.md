# Changelog

## 0.1.2 — 2026-10-04

- Context shows a curve of what the model read after every reply, with turns as regions and each
  compaction labelled; the table's bars are grey, and violet marks the turn in hand.
- A session that starts while the app is open appears on the start page at once, under its project,
  instead of after up to 15 s under "No repository".
- A running turn stays "Working" between a tool's result and the model's next step.
- A session's elapsed time and its last turn's duration are right when a technology was detected.
- A compaction after a `/compact` turn is marked.
- Demo: an eleventh session (OCR for scanned slides and figures), and `--live`, which plays it in
  line by line so live mode can be seen.

## 0.1.1 — 2026-09-29

- Logo, favicon and social preview.
- Screenshots retaken with the new header, plus phone-width ones.
- README: install with `npx @vamp08/agenttrace`.
- Git roots are keyed by real path, so a repository under a symlinked or short-named folder is no
  longer listed twice; a served document keeps the path it was listed under.
- CI on Linux, macOS and Windows.

## 0.1.0 — 2026-09-29

First public release on npm as `@vamp08/agenttrace`.

- Sessions read live from Claude Code's transcript files: Story, Turns, Files, Helpers and Context
  views.
- Every version of every file a session edited, with the diff and the call that wrote it.
- A project's learning record as lessons, a review deck, decisions and a journal.
- Search across every record on the machine.
- A generated demo (`--demo`) and a static online preview.
