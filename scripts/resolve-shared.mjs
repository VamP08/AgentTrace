#!/usr/bin/env node
// `@agenttrace/shared` is a workspace, so it only resolves through a node_modules link that the
// published package does not have. tsc keeps the bare specifier, so point it at the built file
// instead: a relative path is right both here and in an installed copy.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'dist');
const target = '../../shared/dist/index.js';
let changed = 0;

for (const name of readdirSync(dist)) {
  if (!name.endsWith('.js')) continue;
  const file = join(dist, name);
  const before = readFileSync(file, 'utf8');
  const after = before.replaceAll("'@agenttrace/shared'", `'${target}'`);
  if (after !== before) (writeFileSync(file, after), changed++);
}

console.log(`resolve-shared: ${changed} file${changed === 1 ? '' : 's'} rewritten`);
