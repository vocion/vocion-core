import type { ComposerMenuSetting } from './composerMenu';
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
 * The rungs, default first. "Done for you" leads since 2026-09-18 (Chris:
 * "the default behavior should be DONE FOR YOU with visibility and ability to
 * edit or undo"): confident, reversible actions run and show as done with
 * Undo (`libs/actions/autoAccept.ts`); anything risky still asks. Autonomy is
 * still earned per action kind — the rung is the ceiling, the policy decides.
 */
export const AUTONOMY_MODES: readonly ConversationAutonomy[] = ['act-within-bounds', 'ask'] as const;

/** The default rung — what a conversation has before anyone chooses. */
export const DEFAULT_AUTONOMY: ConversationAutonomy = 'act-within-bounds';

/**
 * Both options with the caller's copy attached.
 * @param copy - Translated strings, supplied by whoever has the i18n provider.
 * @returns The options in rung order.
 */
export function autonomyOptions(copy: AutonomyCopy): AutonomyOption[] {
  return [
    { value: 'act-within-bounds', label: copy.act, hint: copy.actHint },
    { value: 'ask', label: copy.ask, hint: copy.askHint },
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

/**
 * Whether a person pulled this thread below the default — ask first. The
 * composer's icon wears the accent then, so "this thread waits for me" is
 * visible without reading.
 * @param mode - The conversation's rung.
 * @returns True for `ask`.
 */
export function isRestrictedAutonomy(mode: ConversationAutonomy | undefined): boolean {
  return mode === 'ask';
}

/** The (+) menu's id for the autonomy rows; `onSetting` matches on it. */
export const AUTONOMY_SETTING_ID = 'autonomy';

/**
 * The rung as a (+) menu section — the composer bar lost its dedicated icon
 * on 2026-09-18 ("this bar is getting too busy"), and the choice lives with
 * everything else the turn can carry.
 * @param value - The conversation's rung.
 * @param copy - Translated strings.
 * @param title - The section title ("This thread").
 */
export function autonomyMenuSetting(value: ConversationAutonomy | undefined, copy: AutonomyCopy, title: string): ComposerMenuSetting {
  return {
    id: AUTONOMY_SETTING_ID,
    title,
    selected: value ?? DEFAULT_AUTONOMY,
    options: autonomyOptions(copy).map(o => ({ id: o.value, label: o.label, hint: o.hint })),
  };
}

/**
 * Read a picked option id back into a rung; anything else is ignored.
 * @param optionId
 */
export function autonomyFromOption(optionId: string): ConversationAutonomy | null {
  return optionId === 'ask' || optionId === 'act-within-bounds' ? optionId : null;
}
