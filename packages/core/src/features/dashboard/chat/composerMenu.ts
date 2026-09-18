/**
 * The composer's ONE menu — pure model.
 *
 * Until 2026-09-18 the input bar had four separate affordances that all
 * answered "what can I put into this turn": a `/` listbox for commands, an
 * `@` listbox for tags, a `(+)` popover listing the attachable records, and
 * a `?` popover of shortcuts. Chris: "unify the / menu, @ menu, and the (+)
 * icon and (?) tooltip in the chat bar. It feels disjointed. Shouldn't that
 * be one system?" It is one system now: one panel, sectioned — Commands,
 * Tag, Add to this turn, Shortcuts — and the way in decides which sections
 * show and which are filtered. `/` filters Commands; `@` filters Tag; `(+)`
 * opens everything you can add (a file, the records, the commands); `?`
 * opens the shortcuts. Same rows, same keys, same look, whichever door.
 *
 * This module decides WHAT the panel holds and in what order; the component
 * (`ComposerMenu.tsx`) only paints it. Keyboard navigation walks
 * `selectableItems`, which skips the shortcut rows (they are a reference).
 */

import type { SlashCommand } from './slashCommands';
import type { ContextRef } from './types';
import { AtSign, Bot, FileText, PencilLine, Target, Users } from 'lucide-react';
import { tagSlug } from './composerTags';
import { matchSlashCommands } from './slashCommands';

/** The icon for a tag chip and a tag row — one table for the box and its panel. */
export const TAG_ICON: Record<ContextRef['type'], typeof Bot> = {
  agent: Bot,
  team: Users,
  mission: Target,
  ask: AtSign,
  object: AtSign,
  briefing: AtSign,
  deal: AtSign,
  page: AtSign,
  deliverable: FileText,
  intent: PencilLine,
};

export type ComposerMenuMode = 'slash' | 'tag' | 'plus' | 'help';

export type ComposerMenuItem
  = | { kind: 'command'; id: string; label: string; hint: string; shortcut?: string; command: SlashCommand }
    | { kind: 'tag'; id: string; label: string; hint: string; ref: ContextRef }
    | { kind: 'file'; id: 'attach-file'; label: string; hint: string }
    | { kind: 'shortcut'; id: string; label: string; keys: string };

export type ComposerMenuSection = {
  id: 'commands' | 'tags' | 'attach' | 'shortcuts';
  title: string;
  items: ComposerMenuItem[];
};

export type ComposerMenuInput = {
  mode: ComposerMenuMode;
  /** The word typed after `/` (slash mode); ignored otherwise. */
  query?: string;
  /** Records already resolved for the `@query` (tag mode) — the caller's `tagSearch` did the filtering. */
  tagHits?: ContextRef[];
  /** What `(+)` can pull in explicitly: `@artifact`, the page, the record in view. */
  attachable?: ContextRef[];
  /** Whether files can be attached on this surface. */
  canAttachFiles?: boolean;
  /** Whether slash commands are wired on this surface. */
  commandsEnabled?: boolean;
  /** The right-hand hint for a tag row — what picking it does. */
  tagHint: (ref: ContextRef) => string;
  /** The shortcut reference, `[keys, what]`. */
  shortcuts: ReadonlyArray<readonly [keys: string, what: string]>;
  words: { commands: string; tag: string; attach: string; attachFile: string; attachFileHint: string; shortcuts: string };
};

/**
 * The sections the panel shows for a way in.
 * @param input - See `ComposerMenuInput`.
 */
export function buildComposerMenu(input: ComposerMenuInput): ComposerMenuSection[] {
  const sections: ComposerMenuSection[] = [];
  const commandItems = (q: string): ComposerMenuItem[] => matchSlashCommands(q).map(c => ({
    kind: 'command' as const,
    id: `command:${c.name}`,
    label: `/${c.name}`,
    hint: c.hint,
    ...(c.shortcut ? { shortcut: c.shortcut } : {}),
    command: c,
  }));
  // A typed `@` row says what picking it does; a (+) row says the tag it
  // types, since that is what lands in the box.
  const tagItems = (refs: ContextRef[], hint: (r: ContextRef) => string): ComposerMenuItem[] => refs.map(r => ({
    kind: 'tag' as const,
    id: `tag:${r.type}:${r.id}`,
    label: r.label,
    hint: hint(r),
    ref: r,
  }));

  switch (input.mode) {
    case 'slash': {
      const items = input.commandsEnabled === false ? [] : commandItems(input.query ?? '');
      if (items.length > 0) {
        sections.push({ id: 'commands', title: input.words.commands, items });
      }
      break;
    }
    case 'tag': {
      const items = tagItems(input.tagHits ?? [], input.tagHint);
      if (items.length > 0) {
        sections.push({ id: 'tags', title: input.words.tag, items });
      }
      break;
    }
    case 'plus': {
      const attach: ComposerMenuItem[] = [];
      if (input.canAttachFiles) {
        attach.push({ kind: 'file', id: 'attach-file', label: input.words.attachFile, hint: input.words.attachFileHint });
      }
      attach.push(...tagItems(input.attachable ?? [], r => `@${tagSlug(r)}`));
      if (attach.length > 0) {
        sections.push({ id: 'attach', title: input.words.attach, items: attach });
      }
      if (input.commandsEnabled !== false) {
        const items = commandItems('');
        if (items.length > 0) {
          sections.push({ id: 'commands', title: input.words.commands, items });
        }
      }
      break;
    }
    case 'help': {
      sections.push({
        id: 'shortcuts',
        title: input.words.shortcuts,
        items: input.shortcuts.map(([keys, what]) => ({ kind: 'shortcut' as const, id: `shortcut:${keys}`, label: what, keys })),
      });
      break;
    }
  }
  return sections;
}

/**
 * The rows the arrow keys walk, in panel order. Shortcut rows are reference
 * only and are skipped.
 * @param sections
 */
export function selectableItems(sections: ComposerMenuSection[]): ComposerMenuItem[] {
  return sections.flatMap(s => s.items.filter(i => i.kind !== 'shortcut'));
}
