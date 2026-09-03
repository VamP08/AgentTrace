import { describe, expect, it } from 'vitest';
import type { Event } from '@agenttrace/shared';
import { detectStack } from '../src/stack.js';

const call = (id: string, name: string, input: unknown): Event => ({ kind: 'tool_call', id, ts: 't', sessionId: 'S', toolUseId: id, name, input });

describe('detectStack', () => {
  it('finds dependencies in package.json, imports in code, and config files by name', () => {
    const events = [
      call('1', 'Write', { file_path: 'e:\\p\\package.json', content: JSON.stringify({ dependencies: { react: '1', 'react-dom': '1', unknownlib: '1' }, devDependencies: { vitest: '1' } }) }),
      call('2', 'Write', { file_path: 'e:\\p\\src\\a.ts', content: "import { WebSocketServer } from 'ws';\nimport x from './local';\nimport chokidar from 'chokidar';" }),
      call('3', 'Write', { file_path: 'e:\\p\\vite.config.ts', content: 'export default {}' }),
      call('4', 'Write', { file_path: 'e:\\p\\app.py', content: 'import numpy as np\nfrom fastapi import FastAPI\nfrom sklearn.linear_model import LinearRegression' }),
      call('5', 'Edit', { file_path: 'e:\\p\\src\\a.ts', old_string: 'x', new_string: "import { z } from 'zod';" }),
      call('6', 'Bash', { command: 'npm install' }),
    ];
    const techs = detectStack(events).map((e) => [e.tech, e.file?.split('\\').pop()]);
    expect(techs).toEqual([
      ['node', 'package.json'],
      ['react', 'package.json'],
      ['vitest', 'package.json'],
      ['ws', 'a.ts'],
      ['chokidar', 'a.ts'],
      ['vite', 'vite.config.ts'],
      ['numpy', 'app.py'],
      ['fastapi', 'app.py'],
      ['scikit-learn', 'app.py'],
      ['zod', 'a.ts'],
    ]);
  });
  it('reports each technology once and keeps the evidence line', () => {
    const events = [
      call('1', 'Write', { file_path: 'a.ts', content: "import React from 'react';" }),
      call('2', 'Write', { file_path: 'b.tsx', content: "import { useState } from 'react';" }),
    ];
    const hits = detectStack(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tech: 'react', evidence: "import React from 'react';", id: 'stack:react' });
  });
  it('a shared seen set carries across live batches', () => {
    const seen = new Set<string>();
    detectStack([call('1', 'Write', { file_path: 'a.ts', content: "import 'react'" })], seen);
    expect(detectStack([call('2', 'Write', { file_path: 'b.ts', content: "import 'react'" })], seen)).toEqual([]);
  });
});
