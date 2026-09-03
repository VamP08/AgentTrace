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

export function gloss(name: string): ToolGloss {
  if (TOOLS[name]) return TOOLS[name];
  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    return { what: `Calls the "${tool}" action of the connected ${server} service.`, look: 'The arguments passed.' };
  }
  return { what: 'A tool without a written explanation yet.', look: 'The raw input.' };
}
