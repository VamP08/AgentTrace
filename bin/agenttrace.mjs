#!/usr/bin/env node
// One process: the API, the live WebSocket and the built page all on the same port.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'server', 'dist', 'index.js');

if (!existsSync(entry) || !existsSync(join(root, 'web', 'dist', 'index.html'))) {
  console.error('agenttrace is not built. Run: npm run build');
  process.exit(1);
}

// --demo: build a made-up project under the temp folder and open the app on that instead of ~/.claude
if (process.argv.includes('--demo')) {
  await import(pathToFileURL(join(root, 'scripts', 'demo.mjs')).href);
  // the demo script starts the app itself, pointed at the demo
  await new Promise(() => {});
}

/** Hand the URL to whatever the desktop uses. A headless machine has none; the printed URL still works. */
function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // no browser to open; nothing to do about it
  }
}

const { start, claudeRoot } = await import(pathToFileURL(entry).href);
const url = await start();
console.log(`AgentTrace  ${url}`);
console.log(`reading     ${claudeRoot}`);
openBrowser(url);
