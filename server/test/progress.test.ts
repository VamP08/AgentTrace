// M11's gate: an answer given seven or more days after the question was last seen is recorded as
// recall, and nothing sooner is; and the progress lives in a file, so a browser reset loses nothing.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendProgress, progressPath, questionId, readProgress, readSlugs, schedule } from '../src/progress.js';
import type { LearningEntry } from '@agenttrace/shared';

const lesson = { slug: 'tailing', title: 'Tailing a file', questions: [{ q: 'How many bytes are read?', a: '200.' }] } as unknown as LearningEntry;
const qid = questionId('tailing', lesson.questions[0]);
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 9));

describe('progress', () => {
  it('counts an answer as recall only seven or more days after the question was last seen', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-progress-'));
    appendProgress(root, { type: 'seen', project: 'P', slug: 'tailing', qid }, day(0));
    const early = appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 5 }, day(6));
    expect(early).toMatchObject({ recall: false });
    // the early answer was itself an exposure, so the clock restarts from day 6
    expect(appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 5 }, day(12))).toMatchObject({ recall: false });
    expect(appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 4 }, day(19))).toMatchObject({ recall: true });
    rmSync(root, { recursive: true, force: true });
  });

  it('never takes recall or the time from the request, and refuses what it does not recognise', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-progress-'));
    const ev = appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 5, recall: true, at: '2020-01-01' }, day(0));
    expect(ev).toMatchObject({ recall: false, at: day(0).toISOString() });
    expect(appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 9 })).toMatch(/grade/);
    expect(appendProgress(root, { type: 'delete', project: 'P', slug: 'x' })).toMatch(/unknown/);
    expect(appendProgress(root, { type: 'read', project: '', slug: 'x' })).toMatch(/required/);
    rmSync(root, { recursive: true, force: true });
  });

  it('schedules with SM-2 on recall answers only, never sooner than seven days after the last sight', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-progress-'));
    appendProgress(root, { type: 'seen', project: 'P', slug: 'tailing', qid }, day(0));
    let [card] = schedule(readProgress(root), 'P', [lesson]);
    expect(card.due).toBe(day(7).toISOString());
    appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 4 }, day(8));
    appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 4 }, day(15));
    appendProgress(root, { type: 'answered', project: 'P', slug: 'tailing', qid, grade: 4 }, day(30));
    [card] = schedule(readProgress(root), 'P', [lesson]);
    // intervals 1, 6, then 6 × 2.5 = 15 days (ease stays 2.5 at quality 4)
    expect(card).toMatchObject({ repetitions: 3, interval: 15, ease: 2.5 });
    expect(card.due).toBe(day(45).toISOString());
    // a question never met in a lesson is not in the deck
    expect(schedule([], 'P', [lesson])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps read marks in the file and survives a line cut short by a crash', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-progress-'));
    appendProgress(root, { type: 'read', project: 'P', slug: 'a' });
    appendProgress(root, { type: 'read', project: 'P', slug: 'b' });
    appendProgress(root, { type: 'unread', project: 'P', slug: 'a' });
    appendFileSync(progressPath(root), '{"type":"read","proj');
    expect(readSlugs(readProgress(root), 'P')).toEqual(['b']);
    rmSync(root, { recursive: true, force: true });
  });

  it('gives a question the same id however the lesson is reordered, and uses the record id when there is one', () => {
    expect(questionId('s', { q: 'Why?' })).toBe(questionId('s', { q: 'Why?' }));
    expect(questionId('s', { q: 'Why?', id: 'q1' })).toBe('s#q1');
  });
});
