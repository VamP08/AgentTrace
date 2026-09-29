# Changelog

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
