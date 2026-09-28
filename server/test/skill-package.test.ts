// The skill that ships in the package is the one the Setup page installs, over whatever copy is
// already installed. On 2026-09-28 the packaged copy was found eighteen days behind: it still
// forbade writing the session id — the contradiction M8 closed — and it had no ownership rule, the
// rule written after a record was deleted with the folder it sat in. Pressing Install would have
// removed both. These are the two lines a stale copy loses first.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(fileURLToPath(new URL('../../skill/SKILL.md', import.meta.url)), 'utf8');

describe('packaged skill', () => {
  it('carries the rule that the record root is a folder the record owns', () => {
    expect(skill).toContain('The record root is a folder the record owns completely');
  });

  it('requires the session id as a join key rather than forbidding it', () => {
    expect(skill).toContain('The `session:` field is the exception, and it is required');
    expect(skill).not.toContain('Never write the session id');
  });
});
