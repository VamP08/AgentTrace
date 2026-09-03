// Watch the projects folder and turn every appended transcript line into events as it lands.
// One byte offset per file; only bytes past the offset are ever read. A trailing partial line
// (the tool is mid-write) is held until its newline arrives.
import { EventEmitter } from 'node:events';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Event } from '@agenttrace/shared';
import { parseLine } from './parse.js';

export interface TailBatch {
  projectSlug: string;
  sessionId: string;
  agentId?: string;
  events: Event[];
}

export interface TailGone {
  projectSlug: string;
  sessionId: string;
  agentId?: string;
}

interface FileState {
  offset: number;
  partial: string;
}

/** Work out which session and agent a transcript path belongs to. Returns undefined for non-transcripts. */
export function classify(projectsDir: string, file: string): { projectSlug: string; sessionId: string; agentId?: string } | undefined {
  const rel = relative(projectsDir, file).split(sep);
  if (rel.length < 2 || rel[0].startsWith('..') || !rel[rel.length - 1].endsWith('.jsonl')) return undefined;
  const projectSlug = rel[0];
  if (rel.length === 2) return { projectSlug, sessionId: rel[1].slice(0, -'.jsonl'.length) };
  const m = /^agent-([0-9a-f]+)\.jsonl$/.exec(rel[rel.length - 1]);
  if (rel[2] !== 'subagents' || !m) return undefined;
  return { projectSlug, sessionId: rel[1], agentId: m[1] };
}

export class Tailer extends EventEmitter {
  private files = new Map<string, FileState>();
  private watcher?: FSWatcher;

  constructor(private projectsDir: string) {
    super();
  }

  start(): this {
    // ponytail: files that already exist start at their current size; the gap between this stat
    // and the watcher attaching is a few ms and history comes over HTTP anyway.
    this.watcher = chokidar.watch(this.projectsDir, { ignoreInitial: false, persistent: true });
    this.watcher.on('add', (file) => this.onAdd(file));
    this.watcher.on('change', (file) => this.onChange(file));
    this.watcher.on('unlink', (file) => this.onUnlink(file));
    this.watcher.on('error', (err) => this.emit('error', err));
    return this;
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }

  private onAdd(file: string) {
    const who = classify(this.projectsDir, file);
    if (!who) return;
    if (this.files.has(file)) return;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    // A file created after start is new content: read from zero. Pre-existing: skip to the end.
    const fresh = this.ready;
    this.files.set(file, { offset: fresh ? 0 : size, partial: '' });
    if (fresh) this.onChange(file);
  }

  private startedAt = Date.now();
  /** chokidar reports pre-existing files as 'add' during its initial scan; treat the first 1.5s as that scan. */
  private get ready(): boolean {
    return Date.now() - this.startedAt > 1500;
  }

  private onChange(file: string) {
    const who = classify(this.projectsDir, file);
    if (!who) return;
    const state = this.files.get(file) ?? { offset: 0, partial: '' };
    this.files.set(file, state);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < state.offset) {
      // truncated or rotated: start over
      state.offset = 0;
      state.partial = '';
    }
    if (size === state.offset) return;
    const chunk = readRange(file, state.offset, size - state.offset);
    state.offset = size;
    const text = state.partial + chunk;
    const lines = text.split('\n');
    state.partial = lines.pop() ?? '';
    const events: Event[] = [];
    for (const line of lines) events.push(...parseLine(line, { sessionId: who.sessionId, agentId: who.agentId }));
    if (events.length) this.emit('events', { ...who, events } satisfies TailBatch);
  }

  private onUnlink(file: string) {
    const who = classify(this.projectsDir, file);
    this.files.delete(file);
    if (who) this.emit('gone', who satisfies TailGone);
  }
}

function readRange(file: string, position: number, length: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = readSync(fd, buf, done, length - done, position + done);
      if (n === 0) break;
      done += n;
    }
    return buf.toString('utf8', 0, done);
  } finally {
    closeSync(fd);
  }
}
