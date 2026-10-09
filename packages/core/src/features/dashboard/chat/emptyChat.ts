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
 * after an Org or workspace switch) is the Org's mark and ONE warm, personal
 * line ("Good evening, Sam.", "Welcome back, Sam."), the composer at the
 * bottom and whitespace between: no heading, no starter chips. Whatever
 * waits on the person (asks, approvals, suggested actions) is never a card
 * there: it is at most ONE soft, dismissible chip by the composer that says
 * how many and opens Review. A docked card
 * (a Decision, an approval) appears on an empty conversation only when the
 * person started the flow it belongs to: a link that named it, a starter
 * they picked.
 *
 * Pure, so every surface (the full-page chat, the rail, the docked Decision)
 * asks the same question and gets the same answer.
 */

// NO CAP ABOVE THE COMPOSER (founder, 2026-10-09: "the card was unreadable
// because the inner scroll content window was so tiny"). A Decision is not
// pinned above the box any more: it is the latest item IN the conversation,
// full height, and the thread scrolls naturally with it (`decisionBlock`).
// What stays above the box is small by nature — the objective's one line, a
// chip — so there is nothing to cap and nothing scrolls inside a box.

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
 * WHAT A CONVERSATION'S DOCK DRAWS — its own Decisions, and what waits on the
 * person elsewhere — by the one rule every surface reads.
 *
 * Founder, 2026-10-09, on a phone, after typing "setup my software factory":
 * "I am confused with two prompts in different areas with diff load in and
 * scroll behavior." A tracker review filed from no conversation docked 400ms
 * after he sent, while the lead was still choosing who answers; the setup
 * step then jumped in front of it, and between steps it came back, beside
 * the lead's own question in the thread.
 *
 * So what waits ELSEWHERE never takes the dock by itself, empty conversation
 * or not: it belongs to no flow the person is in. It is the one soft chip
 * ("1 thing waiting on you"), shown only while nothing of this conversation's
 * own is docked and no turn is running, and it docks the queue here when the
 * person taps it — they started that flow. This conversation's own Decisions
 * dock as before: once it is under way, or when the person started its flow.
 * @param input - What the surface knows.
 * @param input.own - This conversation's open Decisions, oldest first.
 * @param input.elsewhere - What waits on the person outside any conversation.
 * @param input.messageCount - Turns in the conversation so far.
 * @param input.personStarted - The person started the flow its own card belongs to.
 * @param input.elsewhereOpened - The person tapped the chip to answer what waits elsewhere here.
 * @param input.streaming - A turn is running.
 */
export function dockPlan<T>(input: { own: T[]; elsewhere: T[]; messageCount: number; personStarted: boolean; elsewhereOpened: boolean; streaming: boolean }): { own: T[]; elsewhere: T[]; nudge: number | null } {
  const own = mayDockCard(input) ? input.own : [];
  const elsewhere = input.elsewhereOpened ? input.elsewhere : [];
  const quiet = own.length === 0 && elsewhere.length === 0 && !input.streaming && input.messageCount > 0;
  return { own, elsewhere, nudge: quiet && input.elsewhere.length > 0 ? input.elsewhere.length : null };
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

/** Browser-storage key: when this person last opened an empty conversation here. */
export const LAST_SEEN_KEY = 'vocion:chat-last-seen';

/** Away this long, and the line says "Welcome back". */
const RETURN_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Whether the person is coming back after a while, rather than here for the
 * first time or a moment ago.
 * @param lastSeen - When they last opened an empty conversation (ms), or null when never.
 * @param now - Now (ms).
 */
export function isReturning(lastSeen: number | null, now: number): boolean {
  return lastSeen !== null && now - lastSeen >= RETURN_AFTER_MS;
}

type Translate = (key: 'greeting' | 'greeting_named' | 'welcome_back' | 'welcome_back_named', values?: Record<string, string>) => string;

/**
 * The one line an empty conversation says: "Welcome back, Sam." to someone
 * coming back after a while, else "Good evening, Sam." by their clock.
 * Without a name, the same line without one.
 * @param input - What the line knows.
 * @param input.hour - 0–23, local time.
 * @param input.returning - Coming back after a while.
 * @param input.firstName - The person's first name, or null.
 * @param t - The surface's translator (`Chat` messages).
 */
export function greetingFor(input: { hour: number; returning: boolean; firstName?: string | null }, t: Translate): string {
  const name = input.firstName ?? null;
  if (input.returning) {
    return name ? t('welcome_back_named', { name }) : t('welcome_back');
  }
  const part = partOfDay(input.hour);
  return name ? t('greeting_named', { part, name }) : t('greeting', { part });
}

/** One agent as the empty conversation draws it. */
export type TeamMember = {
  slug: string;
  /** What the agent is called in a sentence; the seeded lead's is its given name or its role ("Ava", "Revenue lead"). */
  name: string;
  accent?: string | null;
  /** The seeded lead: what a person reads for it ("Ava · Revenue lead"). */
  leadLabel?: string;
  /** The seeded lead: the given name an Org set, when it set one. */
  givenName?: string;
  /** The seeded lead: its role ("Revenue lead"). */
  leadRole?: string;
};

/** How many agents the cluster draws before "+N". */
export const TEAM_SHOWN = 4;

/**
 * The workspace's team for an empty conversation: its lead first, then the
 * rest in the order the surface lists them, never the virtual search entry.
 * @param agents - The surface's agents.
 * @param leadSlug - The agent a fresh conversation opens with.
 */
export function teamOf(agents: ReadonlyArray<TeamMember & { slug: string }>, leadSlug: string): { lead: TeamMember | null; members: TeamMember[] } {
  const real = agents.filter(a => a.slug !== '__search__');
  const lead = real.find(a => a.slug === leadSlug) ?? real[0] ?? null;
  const members = lead ? [lead, ...real.filter(a => a.slug !== lead.slug)] : real;
  return { lead, members };
}

/**
 * Who the composer asks: the team, or the one agent by name when it is alone.
 * @param members - The team, lead first.
 * @param t - The surface's translator (`Chat` messages).
 */
export function composerAsk(members: readonly TeamMember[], t: (key: 'ask_team' | 'ask_agent', values?: Record<string, string>) => string): string {
  return members.length === 1 ? t('ask_agent', { name: members[0]!.name }) : t('ask_team');
}

/**
 * The second line under the greeting: the team is on it, or the one agent is.
 * @param input - What the line knows.
 * @param input.workspace - The workspace's short name.
 * @param input.members - The team, lead first.
 * @param t - The surface's translator (`Chat` messages).
 */
export function teamLine(input: { workspace: string; members: readonly TeamMember[] }, t: (key: 'team_on_it' | 'agent_on_it' | 'named_lead_and_team_on_it', values?: Record<string, string>) => string): string | null {
  const lead = input.members[0];
  if (!lead) {
    return null;
  }
  if (input.members.length === 1) {
    return t('agent_on_it', { name: lead.name });
  }
  // A lead with a given name speaks for the team: "Ava and the team are on it."
  return lead.givenName ? t('named_lead_and_team_on_it', { name: lead.givenName }) : t('team_on_it', { workspace: input.workspace });
}
