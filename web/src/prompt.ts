// What a person typed, as opposed to what the coding tool wrapped around it or sent in their name.

/**
 * The typed words of a user message, or undefined when the tool wrote the whole message (a task
 * notification, a hook's output, an interruption marker). Blocks the tool adds around a prompt
 * (`<system-reminder>`, `<ide_opened_file>`, `<ide_selection>`) are removed; a slash command shows as
 * the command and its arguments.
 */
export function said(prompt: string): string | undefined {
  const cmd = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(prompt);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(prompt)?.[1].trim();
    return args ? `${cmd[1]} ${args}` : cmd[1];
  }
  const t = prompt.replace(/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!t || /^\[Request interrupted/.test(t)) return undefined;
  return t;
}

/** A reply is Markdown; where it is shown as plain text, show its words, not its asterisks and backticks. */
export function plain(md: string): string {
  return md.replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '');
}
