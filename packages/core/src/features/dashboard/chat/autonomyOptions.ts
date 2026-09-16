import type { ConversationAutonomy } from './types';

/**
 * The conversation's autonomy rung as data (agent-chat-surface.md §9.7).
 *
 * Until 2026-09-15 this lived as two segmented buttons inside the composer,
 * where a *per-conversation setting* competed with the one per-message action
 * (send). The rung moved to the rail header as a quiet chip; this module is
 * the part that has no chrome — the option list, its copy resolution and the
 * label a collapsed chip shows — so both the chip and its popover read from
 * one place, and the ordering/selection can be tested without a DOM.
 */

export type AutonomyCopy = {
  ask: string;
  act: string;
  askHint: string;
  actHint: string;
};

export type AutonomyOption = {
  value: ConversationAutonomy;
  /** Short label — the chip, and the popover row's title. */
  label: string;
  /** One line saying what choosing it means. */
  hint: string;
};

/**
 * The rungs, lowest first. "Ask before acting" is the default, so it leads;
 * a person reading top-to-bottom sees where they are before what is next
 * (Manifesto §8 — automation is earned one rung at a time).
 */
export const AUTONOMY_MODES: readonly ConversationAutonomy[] = ['ask', 'act-within-bounds'] as const;

/** The default rung — what a conversation has before anyone chooses. */
export const DEFAULT_AUTONOMY: ConversationAutonomy = 'ask';

/**
 * Both options with the caller's copy attached.
 * @param copy - Translated strings, supplied by whoever has the i18n provider.
 * @returns The options in rung order.
 */
export function autonomyOptions(copy: AutonomyCopy): AutonomyOption[] {
  return [
    { value: 'ask', label: copy.ask, hint: copy.askHint },
    { value: 'act-within-bounds', label: copy.act, hint: copy.actHint },
  ];
}

/**
 * The label for one rung — what the header chip says at a glance.
 * @param mode - The conversation's rung. Anything unknown reads as the default.
 * @param copy - Translated strings.
 * @returns The short label.
 */
export function autonomyLabel(mode: ConversationAutonomy | undefined, copy: AutonomyCopy): string {
  return mode === 'act-within-bounds' ? copy.act : copy.ask;
}

/**
 * The one-line consequence for one rung.
 * @param mode - The conversation's rung.
 * @param copy - Translated strings.
 * @returns The hint line.
 */
export function autonomyHint(mode: ConversationAutonomy | undefined, copy: AutonomyCopy): string {
  return mode === 'act-within-bounds' ? copy.actHint : copy.askHint;
}

/**
 * Whether a rung is the raised one — the chip wears the accent only then, so
 * "this thread proposes on its own" is visible without reading.
 * @param mode - The conversation's rung.
 * @returns True for `act-within-bounds`.
 */
export function isRaisedAutonomy(mode: ConversationAutonomy | undefined): boolean {
  return mode === 'act-within-bounds';
}
