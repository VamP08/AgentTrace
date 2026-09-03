// Deterministic technology detection from what the session wrote. No model: a dependency file,
// an import line or a config file name is the evidence, and the evidence is kept with the hit.
import type { Event, StackDetectedEvent } from '@agenttrace/shared';
import { STACK } from '@agenttrace/shared';

const CONFIG_FILES: [RegExp, string][] = [
  [/(^|[\\/])vite\.config\.[cm]?[jt]s$/i, 'vite'],
  [/(^|[\\/])tsconfig(\..*)?\.json$/i, 'typescript'],
  [/(^|[\\/])Dockerfile$/i, 'docker'],
  [/(^|[\\/])docker-compose\.ya?ml$/i, 'docker'],
  [/(^|[\\/])pyproject\.toml$/i, 'python'],
  [/(^|[\\/])requirements\.txt$/i, 'python'],
  [/(^|[\\/])environment\.ya?ml$/i, 'conda'],
  [/(^|[\\/])package\.json$/i, 'node'],
  [/(^|[\\/])tailwind\.config\.[cm]?[jt]s$/i, 'tailwindcss'],
  [/(^|[\\/])next\.config\.[cm]?[jt]s$/i, 'nextjs'],
  [/(^|[\\/])vitest\.config\.[cm]?[jt]s$/i, 'vitest'],
  [/(^|[\\/])jest\.config\.[cm]?[jt]s$/i, 'jest'],
  [/(^|[\\/])playwright\.config\.[cm]?[jt]s$/i, 'playwright'],
  [/(^|[\\/])\.github[\\/]workflows[\\/].+\.ya?ml$/i, 'github-actions'],
  [/(^|[\\/])alembic\.ini$/i, 'alembic'],
  [/(^|[\\/])prisma[\\/]schema\.prisma$/i, 'prisma'],
  [/\.ipynb$/i, 'jupyter'],
  [/\.sql$/i, 'sql'],
  [/\.rs$/i, 'rust'],
  [/\.go$/i, 'go'],
];

const JS_IMPORT = /(?:^|\n)\s*(?:import\s[^'"]*?from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"./][^'"]*)['"]/g;
const PY_IMPORT = /(?:^|\n)\s*(?:from\s+([A-Za-z_][\w]*)|import\s+([A-Za-z_][\w]*))/g;

function normalizeModule(name: string): string {
  // "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg"
  const parts = name.split('/');
  return name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Run the detector over events, emitting one stack_detected per technology the first time it appears. */
export function detectStack(events: Event[], seen: Set<string> = new Set()): StackDetectedEvent[] {
  const out: StackDetectedEvent[] = [];
  const hit = (tech: string, evidence: string, e: Event, file?: string) => {
    if (!STACK[tech] || seen.has(tech)) return;
    seen.add(tech);
    out.push({ kind: 'stack_detected', id: `stack:${tech}`, ts: e.ts, sessionId: e.sessionId, agentId: e.agentId, tech, evidence: evidence.trim().slice(0, 160), file });
  };
  for (const e of events) {
    if (e.kind !== 'tool_call') continue;
    const input = (e.input ?? {}) as Record<string, any>;
    const file: string | undefined = input.file_path ?? input.notebook_path;
    const text: string = typeof input.content === 'string' ? input.content : typeof input.new_string === 'string' ? input.new_string : '';
    if (file) for (const [re, tech] of CONFIG_FILES) if (re.test(file)) hit(tech, file, e, file);
    if (!text) continue;
    if (file && /package\.json$/i.test(file)) {
      try {
        const pkg = JSON.parse(text);
        for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) hit(depToTech(dep), `"${dep}" in ${file}`, e, file);
      } catch {
        // partial or invalid JSON in an edit: fall through to import scanning
      }
    }
    if (file && /(requirements\.txt|pyproject\.toml)$/i.test(file)) {
      for (const line of text.split('\n')) {
        const m = /^\s*"?([A-Za-z0-9_.-]+)/.exec(line);
        if (m) hit(depToTech(m[1].toLowerCase()), line, e, file);
      }
    }
    if (!file || /\.(m?[jt]sx?|vue|svelte)$/i.test(file)) {
      for (const m of text.matchAll(JS_IMPORT)) hit(depToTech(normalizeModule(m[1])), lineAt(text, m.index ?? 0, m[0]), e, file);
    }
    if (!file || /\.py$/i.test(file)) {
      for (const m of text.matchAll(PY_IMPORT)) hit(depToTech((m[1] ?? m[2]).toLowerCase()), lineAt(text, m.index ?? 0, m[0]), e, file);
    }
  }
  return out;
}

/** The whole source line a match sits on; matches may begin at the preceding newline. */
function lineAt(text: string, index: number, matched: string): string {
  const start = index + (matched.startsWith('\n') ? 1 : 0);
  const from = text.lastIndexOf('\n', start) + 1;
  const to = text.indexOf('\n', start);
  return text.slice(from, to === -1 ? undefined : to);
}

const ALIASES: Record<string, string> = {
  'react-dom': 'react', '@types/react': 'react', '@types/react-dom': 'react',
  '@vitejs/plugin-react': 'vite', '@tanstack/react-virtual': 'tanstack-virtual',
  '@types/node': 'node', '@types/ws': 'ws', 'node:fs': 'node', 'node:http': 'node', 'node:path': 'node',
  'node:os': 'node', 'node:events': 'node', 'node:readline': 'node', 'node:child_process': 'node', 'node:url': 'node',
  sklearn: 'scikit-learn', np: 'numpy', pd: 'pandas', cv2: 'opencv', PIL: 'pillow', bs4: 'beautifulsoup',
  yaml: 'pyyaml', dotenv: 'python-dotenv', 'langchain_core': 'langchain', 'langchain_openai': 'langchain',
  'langchain_community': 'langchain', 'langgraph': 'langgraph', 'sqlalchemy': 'sqlalchemy',
};

function depToTech(dep: string): string {
  return ALIASES[dep] ?? dep;
}
