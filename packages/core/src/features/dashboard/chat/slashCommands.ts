/**
 * Slash commands in the composer — `/new`, `/history`, `/search …`.
 *
 * Why: on 2026-09-18 Chris typed `/clear` into the rail and the model
 * answered "Got it — context cleared." Nothing was cleared; the model
 * pretended, because a slash command it does not know is just text to it.
 * A command the surface owns never reaches the model (CLAUDE.md, structural
 * over prompting): the composer recognises it, runs it, and empties the box.
 *
 * Same shape as the `@` tag menu (`composerTags.ts`): a `/` at the start of
 * an otherwise-empty draft opens a list, Enter picks the highlighted row. The
 * verbs are the chat hotkeys' verbs (`chatHotkeys.ts`), so the row shows
 * the key too.
 */

import type { ChatHotkeyAction } from './chatHotkeys';
import { chatHotkeyLabel } from './chatHotkeys';

export type SlashCommandAction = ChatHotkeyAction | 'search' | 'help';

export type SlashCommand = {
  /** The word after the slash. */
  name: string;
  aliases: readonly string[];
  label: string;
  /** What picking it does, shown beside the label. */
  hint: string;
  action: SlashCommandAction;
  /** `⌘⇧O` and friends, when a hotkey does the same thing. */
  shortcut?: string;
  /** A command that takes an argument is typed, not run, when picked. */
  takesArgument?: boolean;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'new', aliases: ['clear', 'reset'], label: 'New chat', hint: 'Start over in a fresh thread', action: 'new-chat', shortcut: chatHotkeyLabel('new-chat') },
  { name: 'history', aliases: ['chats', 'conversations', 'list'], label: 'All conversations', hint: 'Every thread, searchable', action: 'all-conversations', shortcut: chatHotkeyLabel('all-conversations') },
  { name: 'search', aliases: [], label: 'Search only', hint: 'Retrieval, no model in the loop', action: 'search', takesArgument: true },
  // Handled by the composer itself: opens the shortcut reference in the same panel.
  { name: 'help', aliases: ['shortcuts', '?'], label: 'Shortcuts', hint: 'Keys and commands', action: 'help' },
];

/** `/` plus a word, alone in the box — the moment the menu is open. */
const OPEN = /^\/([\w-]*)$/;

/**
 * The `/query` under the caret when the person is typing a command, else null.
 * Only at the start of an otherwise-empty draft: a slash inside a sentence is
 * a slash.
 * @param value - The whole draft.
 */
export function slashQuery(value: string): string | null {
  const m = OPEN.exec(value);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Commands matching a query — by name first, then by alias, in table order.
 * @param query - The word typed after the slash (may be empty).
 */
export function matchSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter(c => c.name.startsWith(q) || c.aliases.some(a => a.startsWith(q)));
}

/**
 * The command a submitted draft IS — `/new`, `/clear`, `/history` — or null
 * when the draft is a message. `/search <query>` is not a command here: it
 * carries text and goes through the send path (`routing.ts`).
 * @param value - The whole draft.
 */
export function parseSlashCommand(value: string): SlashCommand | null {
  const m = /^\/([\w-]+)\s*$/.exec(value.trim());
  if (!m) {
    return null;
  }
  const word = m[1]!.toLowerCase();
  const cmd = SLASH_COMMANDS.find(c => c.name === word || c.aliases.includes(word));
  return cmd && !cmd.takesArgument ? cmd : null;
}
