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
  TodoWrite: { what: 'Writes down the checklist it is working through, and ticks items off as it goes.', look: 'Which item just moved to in-progress or done; the list is how it is keeping its place.' },
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
  mysql: { category: 'storage', what: 'A relational database server; the one most web hosts offer by default.' },
  flyway: { category: 'storage', what: 'Applies numbered SQL files to a database in order, so every copy of the schema is built the same way.' },
  hibernate: { category: 'storage', what: 'Maps Java classes to database tables and writes the SQL for them.' },
  java: { category: 'language', what: 'A typed, compiled language that runs on its own virtual machine.' },
  maven: { category: 'build', what: 'Builds a Java project from one pom.xml that lists its dependencies.' },
  'spring-boot': { category: 'framework', what: 'A Java web framework that wires a server, security and database access from configuration.' },
  junit: { category: 'test', what: 'The standard test runner for Java.' },
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

/**
 * Tools reached through an MCP server, keyed by the action name after the server prefix.
 * G16: these were falling to a generated template naming the server and the action, which
 * repeats the tool name rather than explaining it. On this machine the browser actions below
 * are called about as often as Bash, so the reader who most needs a line was the one not
 * getting one.
 */
const MCP_ACTIONS: Record<string, ToolGloss> = {
  browser_navigate: { what: 'Opens a web address in a real browser the model is driving.', look: 'The URL.' },
  browser_snapshot: { what: 'Reads the page as a list of its elements, the way a screen reader would, so the model can find things by name rather than by pixel.', look: 'The element the next step refers to.' },
  browser_click: { what: 'Clicks something on the page.', look: 'Which element, named as the snapshot named it.' },
  browser_type: { what: 'Types text into a field on the page.', look: 'The field and the text.' },
  browser_fill_form: { what: 'Fills several form fields in one go.', look: 'The field names and the values.' },
  browser_select_option: { what: 'Chooses an option from a dropdown.', look: 'The dropdown and the option.' },
  browser_hover: { what: 'Moves the pointer over something without clicking.', look: 'The element.' },
  browser_press_key: { what: 'Presses one key, such as Enter or Escape.', look: 'The key.' },
  browser_take_screenshot: { what: 'Saves a picture of the page as it looks now.', look: 'The file it was saved to.' },
  browser_console_messages: { what: 'Reads the errors and logs the page itself printed.', look: 'Errors first; they explain a broken page.' },
  browser_network_requests: { what: 'Lists the requests the page made and what came back.', look: 'Any request that failed or returned an error status.' },
  browser_evaluate: { what: 'Runs a snippet of JavaScript inside the page and returns the result.', look: 'The snippet, then the value it returned.' },
  browser_wait_for: { what: 'Waits until something appears, disappears, or a set time passes.', look: 'What it is waiting for.' },
  browser_resize: { what: 'Changes the browser window size, usually to check a layout at another width.', look: 'The width and height.' },
  browser_close: { what: 'Closes the browser.', look: 'Nothing to read.' },
  browser_tabs: { what: 'Lists, opens, closes or switches browser tabs.', look: 'Which action, and which tab.' },
  browser_handle_dialog: { what: 'Answers a browser popup such as an alert or a confirm box.', look: 'Whether it accepted or dismissed.' },
  browser_drag: { what: 'Drags one element onto another.', look: 'The two elements.' },
  browser_file_upload: { what: 'Attaches a file to a file input on the page.', look: 'The file path.' },
  browser_find: { what: 'Searches the page for text or a pattern.', look: 'What it searched for.' },
};

/** What each connected MCP server is, for actions with no line of their own. */
const MCP_SERVERS: Record<string, string> = {
  playwright: 'a real browser it drives',
  figma: 'the Figma design service',
};

export function gloss(name: string): ToolGloss {
  if (TOOLS[name]) return TOOLS[name];
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    const action = rest.join('__');
    const known = MCP_ACTIONS[action];
    if (known) return known;
    const where = MCP_SERVERS[server] ?? `the connected ${server} service`;
    const readable = action.replace(/_+/g, ' ').trim();
    return {
      what: `Asks ${where} to ${readable || 'do something'}. This app has no written line for that action yet.`,
      look: 'The arguments passed, then the result.',
    };
  }
  return {
    what: `${name} is a tool this app has no written explanation for. It is not part of the built-in set, so it came from a plugin or a connected service.`,
    look: 'The raw input, then the result underneath.',
  };
}
