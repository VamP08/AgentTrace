// G16: MCP actions and TodoWrite had no written line, while being among the most-called tools
// on this machine. The first-appearance explanation is the app's central promise, so the case
// that matters most is the one with no entry: it must name what it cannot explain.
import { describe, it, expect } from 'vitest';
import { gloss } from '../../shared/src/glossary.js';

describe('gloss', () => {
  it('explains a built-in tool', () => {
    expect(gloss('Bash').what).toMatch(/terminal/i);
  });

  it('explains TodoWrite, which the reader sees constantly', () => {
    const g = gloss('TodoWrite');
    expect(g.what).toMatch(/checklist/i);
    expect(g.what).not.toMatch(/no written explanation/i);
  });

  it('explains a known MCP action in its own words, not by repeating its name', () => {
    const g = gloss('mcp__playwright__browser_snapshot');
    expect(g.what).toMatch(/screen reader/i);
    expect(g.what).not.toMatch(/browser_snapshot/);
  });

  it('names the server in plain words for an MCP action it does not know', () => {
    const g = gloss('mcp__playwright__browser_teleport');
    expect(g.what).toMatch(/a real browser it drives/);
    expect(g.what).toMatch(/browser teleport/);
    expect(g.what).toMatch(/no written line/i);
  });

  it('handles an MCP action whose name itself contains the separator', () => {
    const g = gloss('mcp__some_server__weave__run_tool');
    expect(g.what).toMatch(/weave run tool/);
  });

  it('names an unknown tool rather than saying only that it is unknown', () => {
    const g = gloss('Password');
    expect(g.what).toMatch(/^Password is a tool/);
    expect(g.what).toMatch(/plugin or a connected service/);
  });
});
