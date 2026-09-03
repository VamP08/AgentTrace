// Plain-language lines for every tool the coding tool can call. Shown above the raw input on
// each card. No model writes these; they are maintained by hand.

export interface ToolGloss {
  /** one sentence, for a reader who does not program */
  what: string;
  /** which part of the input is worth reading first */
  look: string;
}

export const TOOLS: Record<string, ToolGloss> = {
  Bash: { what: 'Runs a command in a terminal, the way a person would type it.', look: 'The command, then the result underneath.' },
  PowerShell: { what: 'Runs a command in the Windows PowerShell terminal.', look: 'The command, then the result underneath.' },
  Read: { what: 'Opens a file and reads it into memory so the next step can use it.', look: 'The file path; a line range means only part was read.' },
  Write: { what: 'Creates a file, or replaces one, with the full text shown.', look: 'The file path and the whole new content.' },
  Edit: { what: 'Changes one exact passage in a file, old text swapped for new.', look: 'The old and new passages side by side.' },
  NotebookEdit: { what: 'Changes one cell in a Jupyter notebook.', look: 'The notebook path and the cell content.' },
  Grep: { what: 'Searches file contents for a pattern, like a find-in-files.', look: 'The pattern and which folder was searched.' },
  Glob: { what: 'Finds files by name pattern, such as every .ts file under a folder.', look: 'The pattern.' },
  Agent: { what: 'Hands a self-contained task to a helper that works separately and reports back.', look: 'The brief: it is the whole instruction the helper receives.' },
  Skill: { what: 'Loads a set of written instructions for a kind of task before continuing.', look: 'The skill name; its text appears as context on the next turn.' },
  ToolSearch: { what: 'Looks up the definition of a tool that was not loaded yet.', look: 'The query.' },
  WebFetch: { what: 'Downloads one web page and summarises it for the given question.', look: 'The URL and the question.' },
  WebSearch: { what: 'Runs a web search and reads the result titles and snippets.', look: 'The query.' },
  AskUserQuestion: { what: 'Pauses to ask the person a question with a few options.', look: 'The question and the options offered.' },
  ExitPlanMode: { what: 'Presents the written plan and waits for approval before any change.', look: 'The plan file it refers to.' },
  EnterPlanMode: { what: 'Switches to planning only: reading and writing a plan, no changes.', look: 'Nothing to read; it is a mode switch.' },
  Artifact: { what: 'Publishes an HTML page to a private web link.', look: 'The file path and the title.' },
  SendMessage: { what: 'Sends a message to another running helper or session.', look: 'The recipient and the message.' },
  ListAgents: { what: 'Lists the helpers and sessions that can be messaged.', look: 'Nothing to read.' },
  Monitor: { what: 'Watches a command or condition in the background and reports when it changes.', look: 'The command being watched.' },
  TaskOutput: { what: 'Reads the output of a background task.', look: 'The task id.' },
  TaskStop: { what: 'Stops a background task.', look: 'The task id.' },
  ScheduleWakeup: { what: 'Sets a timer to come back and continue later.', look: 'The delay and the reason.' },
  Workflow: { what: 'Runs a script that coordinates several helpers at once.', look: 'The script: its phases name the plan.' },
  ReportFindings: { what: 'Reports the results of a code review as a list.', look: 'Each finding, most serious first.' },
};

export interface StackGloss {
  category: 'language' | 'runtime' | 'framework' | 'ui' | 'storage' | 'network' | 'build' | 'test' | 'data' | 'ai' | 'deploy' | 'other';
  what: string;
}

/** Technologies the detector can name. A hit on anything else is ignored rather than guessed. */
export const STACK: Record<string, StackGloss> = {
  node: { category: 'runtime', what: 'Runs JavaScript on the computer itself, outside a browser.' },
  typescript: { category: 'language', what: 'JavaScript with declared shapes for values, checked before the program runs.' },
  python: { category: 'language', what: 'A general-purpose language with a large library for data and web work.' },
  conda: { category: 'build', what: 'Creates isolated Python environments with pinned packages.' },
  rust: { category: 'language', what: 'A systems language with memory safety checked at compile time.' },
  go: { category: 'language', what: 'A compiled language built for servers and command-line tools.' },
  sql: { category: 'storage', what: 'The query language relational databases speak.' },
  react: { category: 'ui', what: 'Describes screens as functions of data; redraws only what changed.' },
  vue: { category: 'ui', what: 'A component framework for building web interfaces.' },
  svelte: { category: 'ui', what: 'A compiler that turns components into small plain JavaScript.' },
  nextjs: { category: 'framework', what: 'A React framework with routing, server rendering and builds.' },
  vite: { category: 'build', what: 'Serves the web app during development and bundles it for release.' },
  tailwindcss: { category: 'ui', what: 'Styling through small utility classes written in the markup.' },
  'tanstack-virtual': { category: 'ui', what: 'Renders only the visible rows of a long list.' },
  express: { category: 'framework', what: 'A small web server framework for Node.' },
  fastify: { category: 'framework', what: 'A fast web server framework for Node.' },
  ws: { category: 'network', what: 'WebSocket server for Node; keeps a two-way connection open.' },
  'socket.io': { category: 'network', what: 'Two-way messaging over WebSocket with fallbacks and rooms.' },
  chokidar: { category: 'other', what: 'Watches folders for file changes across operating systems.' },
  'gray-matter': { category: 'data', what: 'Splits a Markdown file into its frontmatter and body.' },
  diff: { category: 'other', what: 'Computes the difference between two texts, line by line.' },
  vitest: { category: 'test', what: 'Runs tests written in TypeScript with no build step.' },
  jest: { category: 'test', what: 'A test runner for JavaScript.' },
  playwright: { category: 'test', what: 'Drives a real browser to test or automate web pages.' },
  tsx: { category: 'build', what: 'Runs TypeScript files directly during development.' },
  zod: { category: 'data', what: 'Declares the shape of data and validates values against it at runtime.' },
  prisma: { category: 'storage', what: 'A database toolkit that generates a typed client from a schema.' },
  drizzle: { category: 'storage', what: 'A typed SQL query builder for TypeScript.' },
  sqlite: { category: 'storage', what: 'A database that lives in one file, no server needed.' },
  'better-sqlite3': { category: 'storage', what: 'SQLite for Node with a synchronous API.' },
  postgres: { category: 'storage', what: 'A relational database server.' },
  redis: { category: 'storage', what: 'An in-memory key-value store used for caches and queues.' },
  docker: { category: 'deploy', what: 'Packages an app with everything it needs into a container.' },
  'github-actions': { category: 'deploy', what: 'Runs builds and tests automatically on every push.' },
  fastapi: { category: 'framework', what: 'A Python web framework with typed request handling.' },
  flask: { category: 'framework', what: 'A minimal Python web framework.' },
  django: { category: 'framework', what: 'A full-featured Python web framework.' },
  uvicorn: { category: 'runtime', what: 'Serves Python web apps that speak ASGI.' },
  pydantic: { category: 'data', what: 'Declares data shapes in Python and validates them.' },
  sqlalchemy: { category: 'storage', what: 'Python toolkit for talking to SQL databases.' },
  alembic: { category: 'storage', what: 'Applies versioned changes to a database schema.' },
  numpy: { category: 'data', what: 'Fast arrays and math for Python.' },
  pandas: { category: 'data', what: 'Tables in Python: load, filter, group, join.' },
  'scikit-learn': { category: 'ai', what: 'Classical machine learning: models, metrics, pipelines.' },
  torch: { category: 'ai', what: 'PyTorch, a deep learning framework.' },
  tensorflow: { category: 'ai', what: 'A deep learning framework from Google.' },
  transformers: { category: 'ai', what: 'Pretrained language and vision models from Hugging Face.' },
  langchain: { category: 'ai', what: 'Building blocks for applications that call language models.' },
  langgraph: { category: 'ai', what: 'State machines for multi-step language model agents.' },
  openai: { category: 'ai', what: 'Client for the OpenAI API.' },
  anthropic: { category: 'ai', what: 'Client for the Claude API.' },
  groq: { category: 'ai', what: 'Client for the Groq inference API.' },
  chromadb: { category: 'storage', what: 'A vector database for embeddings.' },
  faiss: { category: 'storage', what: 'Fast similarity search over vectors.' },
  requests: { category: 'network', what: 'Makes HTTP requests from Python.' },
  httpx: { category: 'network', what: 'HTTP client for Python with async support.' },
  pytest: { category: 'test', what: 'The standard Python test runner.' },
  jupyter: { category: 'data', what: 'Notebooks mixing code, output and prose.' },
  streamlit: { category: 'ui', what: 'Turns a Python script into a web app.' },
  matplotlib: { category: 'data', what: 'Charts and plots in Python.' },
  plotly: { category: 'data', what: 'Interactive charts.' },
  pillow: { category: 'data', what: 'Image loading and editing in Python.' },
  opencv: { category: 'data', what: 'Computer vision library.' },
  beautifulsoup: { category: 'data', what: 'Parses HTML to pull data out of web pages.' },
  pyyaml: { category: 'data', what: 'Reads and writes YAML in Python.' },
  'python-dotenv': { category: 'other', what: 'Loads settings from a .env file.' },
};

export function gloss(name: string): ToolGloss {
  if (TOOLS[name]) return TOOLS[name];
  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    return { what: `Calls the "${tool}" action of the connected ${server} service.`, look: 'The arguments passed.' };
  }
  return { what: 'A tool without a written explanation yet.', look: 'The raw input.' };
}
