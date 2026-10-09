/**
 * HOW A CONVERSATION STARTS — the rule every chat surface shares.
 *
 * Founder, 2026-10-08, on a phone, in a workspace with three proposals
 * waiting: "Not a great starting point … it started with a big action card.
 * I can't scroll to see the chat. Chat should always start with a much warmer
 * intro with very little on the chat screen. Not jump right to big asks.
 * Maybe a soft nudge or chip. If that."
 *
 * So an empty conversation (a new chat, a workspace's first open, the chat
 * after an Org or workspace switch) is a greeting from the workspace's lead
 * and two or three quiet starters. Whatever waits on the person (asks,
 * approvals, suggested actions) is never a card there: it is at most ONE
 * soft, dismissible chip that says how many and opens Review. A docked card
 * (a Decision, an approval) appears on an empty conversation only when the
 * person started the flow it belongs to: a link that named it, a starter
 * they picked.
 *
 * Pure, so every surface (the full-page chat, the rail, the docked Decision)
 * asks the same question and gets the same answer.
 */

/** How many starters an empty conversation offers: a nudge, not a menu. */
export const MAX_STARTERS = 3;

/**
 * The tallest anything pinned above the composer may be on a phone: a quarter
 * of the viewport. What is taller scrolls inside it, so the conversation above
 * always keeps the screen and always scrolls. A desktop has the room.
 */
export const PINNED_MAX_CLASS = 'max-md:max-h-[25dvh] max-md:overflow-y-auto max-md:overscroll-contain';

/**
 * Whether a docked card (a Decision, an approval, a suggested action) may be
 * drawn on this conversation now.
 * @param input - What the surface knows.
 * @param input.messageCount - Turns in the conversation so far.
 * @param input.personStarted - The person started the flow the card belongs to (a link that named it, a starter they picked).
 */
export function mayDockCard(input: { messageCount: number; personStarted: boolean }): boolean {
  return input.messageCount > 0 || input.personStarted;
}

/**
 * What an empty conversation says about the things waiting on the person: a
 * count for the one soft chip, or null when there is nothing to say or the
 * person has already waved it away.
 * @param input - What waits.
 * @param input.waiting - How many proposals, asks and approvals wait on the person.
 * @param input.dismissed - The person dismissed the chip in this browser session.
 */
export function waitingNudgeCount(input: { waiting: number; dismissed: boolean }): number | null {
  return input.waiting > 0 && !input.dismissed ? input.waiting : null;
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * Morning, afternoon or evening, by the person's own clock.
 * @param hour - 0–23, local time.
 */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) {
    return 'morning';
  }
  if (hour >= 12 && hour < 18) {
    return 'afternoon';
  }
  return 'evening';
}

/**
 * The name a greeting uses: the first word of the person's name, never an
 * email address. Null when there is nothing friendly to say.
 * @param name - The signed-in person's display name.
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first && !first.includes('@') ? first : null;
}

/**
 * The starters an empty conversation shows, capped.
 * @param starters - Every starter the surface could offer, best first.
 */
export function startersToShow<T>(starters: readonly T[]): T[] {
  return starters.slice(0, MAX_STARTERS);
}
