/**
 * THE OPENING HINT — the one quiet suggestion by the composer of an empty
 * conversation (founder, 2026-10-09: "smart and dynamic, but still usually ONE
 * suggestion"). It replaced the fixed "N things waiting on you" chip, which is
 * now one candidate among several.
 *
 * A pure ranker over what the server already knows about this person and this
 * workspace — no model call on load. Every candidate type scores
 * base × boosts × decay, there is at most one candidate per type, and the
 * copy is templated and personal ("Reconnect HubSpot — the Revenue lead
 * couldn't read deals today →"). The top hint shows; a second shows only when
 * it is a different type and scores within ~15% of the top; never more than
 * two; nothing at all when nothing clears the bar.
 *
 * Only actions the person can take: a member never sees "finish setup" for a
 * step only an admin can take — they see "Ask an admin to finish …", and only
 * when it is blocking them. A dismissal hides that item for 7 days and lowers
 * that type's weight for that person; acting on it removes it (the item is
 * then simply no longer true).
 *
 * The weights are constants here, so the shown / clicked / dismissed events
 * (`chat.hint_*`, `services/adoption/events.ts`) can tune them.
 */

import type { ConnectorKind } from '@/libs/connect/connectorKinds';
import { CONNECTOR_KIND_ONE } from '@/libs/connect/connectorKinds';

export const HINT_TYPES = ['setup', 'connector', 'attention', 'next', 'capability'] as const;
export type HintType = (typeof HINT_TYPES)[number];

/** What clicking a hint does: send the ask in chat, or open a page or flow. */
export type HintAction = { kind: 'send'; prompt: string } | { kind: 'open'; href: string };

export type OpeningHint = {
  /** Stable for the item it is about, so a dismissal hides that item, not its type. */
  key: string;
  type: HintType;
  /** The chip's words. */
  label: string;
  /** "Why this?" — one line. */
  reason: string;
  score: number;
  action: HintAction;
  /** The conversation it picks back up, when it resumes a setup the person started there. */
  resumes?: number;
};

export type HintInput = {
  now: Date;
  person: {
    isAdmin: boolean;
    /** Conversations this person has started in this workspace. */
    sessions: number;
    /** Messages this person has sent in this workspace. */
    messagesSent: number;
  };
  workspace: {
    createdAt: Date;
    /** What the lead is called in a sentence ("the Revenue lead", "Ava"). */
    leadSpoken: string;
  };
  /** Installed apps and objectives with setup steps left. */
  apps: Array<{
    slug: string;
    name: string;
    installedAt?: Date | null;
    installedByPerson?: boolean;
    steps: Array<{ label: string; done: boolean; adminOnly: boolean }>;
    /** Its unfinished steps keep agents from running. */
    blocksAgents: boolean;
    /** Where finishing it starts (the Decision / connect flow). */
    href: string;
    /**
     * The person already started setting it up in a conversation (its
     * objective, `libs/objectives/objective.ts`): the hint resumes it there,
     * "Resume setting up … →", rather than starting over.
     */
    resume?: { conversationId: number } | null;
  }>;
  /** Connections that are not working, or that an installed app needs. */
  connectors: Array<{
    slug: string;
    name: string;
    /** Team (the workspace's shared systems) or personal (the person's own); team when absent. */
    kind?: ConnectorKind;
    state: 'broken' | 'expired' | 'incomplete' | 'needed';
    /** The app that needs it, for `needed`. */
    neededBy?: string;
    /** Times it came up in the last 7 days (mentioned, or a tool that needs it was tried). */
    recentTouches: number;
    /** What went wrong lately, in a clause ("couldn't read deals today"). */
    touchNote?: string;
    href: string;
  }>;
  /** What waits on the person. */
  waiting: Array<{ kind: 'approval' | 'ask' | 'fyi'; ageHours: number; blocksRun: boolean }>;
  /**
   * The next best action, when the workspace has one to suggest. With `href`
   * it opens that page instead of sending `prompt` (a brief that is already
   * written: "Your morning brief is ready →"); `weight` scales its score for
   * something that is the person's own and fresh today.
   */
  next?: { key: string; label: string; prompt: string; reason: string; href?: string; weight?: number } | null;
  /** This person's dismissals in the last 30 days. */
  dismissed: Array<{ key: string; type: HintType; at: Date }>;
};

const DAY = 24 * 60 * 60 * 1000;

/** Below this, a hint is not worth the space. */
export const HINT_FLOOR = 25;

/** A second hint must score at least this share of the top one. */
export const SECOND_HINT_SHARE = 0.85;

/** How long a dismissed item stays hidden. */
export const DISMISS_DAYS = 7;

/** A setup the person already started, and left: picking it back up outranks starting one. */
const RESUME_BOOST = 1.8;

/** Each dismissal of a type in the last 30 days multiplies that type's weight by this. */
const DISMISS_TYPE_DECAY = 0.8;

const BASE: Record<HintType, number> = { setup: 80, connector: 85, attention: 40, next: 50, capability: 70 };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function setupCandidate(input: HintInput): OpeningHint | null {
  let best: OpeningHint | null = null;
  for (const app of input.apps) {
    const left = app.steps.filter(s => !s.done);
    const next = left[0];
    if (!next) {
      continue;
    }
    const canFinish = input.person.isAdmin || left.every(s => !s.adminOnly);
    if (!canFinish && !app.blocksAgents) {
      continue;
    }
    let score = BASE.setup;
    if (app.installedAt && input.now.getTime() - app.installedAt.getTime() < 7 * DAY) {
      score *= 1.3;
    }
    if (app.installedByPerson) {
      score *= 1.2;
    }
    score *= 1 + 0.15 * Math.max(0, 5 - left.length);
    if (app.blocksAgents) {
      score *= 1.4;
    }
    // Started in a conversation and left: open it where it stands, its line
    // above the dock ("Setting up … · 2 of 3"), never a fresh start.
    const resume = app.resume ?? null;
    const hint: OpeningHint = resume
      ? {
          key: `setup:${app.slug}`,
          type: 'setup',
          label: `Resume ${app.name} setup →`,
          reason: `${left.length} ${plural(left.length, 'step', 'steps')} left; next: ${next.label}.`,
          score: score * RESUME_BOOST,
          action: { kind: 'open', href: `/dashboard/chat?conversation=${resume.conversationId}` },
          resumes: resume.conversationId,
        }
      : canFinish
        ? {
            key: `setup:${app.slug}`,
            type: 'setup',
            // Leads with the action, short enough to read whole at 390px.
            label: `Finish ${app.name} setup · ${left.length} ${plural(left.length, 'step', 'steps')} →`,
            reason: app.blocksAgents ? `Its agents can't run until ${next.label.toLowerCase()} is done.` : `${app.name} is not finished yet; ${next.label.toLowerCase()} is next.`,
            score,
            // A prompt, never a shortcut: the person's own ask starts a turn,
            // and the lead raises whatever it decides to (founder, 2026-10-09).
            action: { kind: 'send', prompt: `Help me finish setting up ${app.name}` },
          }
        : {
            key: `setup:${app.slug}`,
            type: 'setup',
            label: `Ask an admin to finish ${app.name} →`,
            reason: `Its agents can't run until an admin finishes setup.`,
            score: score * 0.6,
            action: { kind: 'send', prompt: `Ask an admin to finish setting up ${app.name}: ${left.map(s => s.label).join(', ')}.` },
          };
    if (!best || hint.score > best.score) {
      best = hint;
    }
  }
  return best;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function connectorCandidate(input: HintInput): OpeningHint | null {
  let best: OpeningHint | null = null;
  for (const c of input.connectors) {
    const stateBoost = c.state === 'broken' || c.state === 'expired' ? 1.25 : c.state === 'incomplete' ? 1 : 0.9;
    const score = BASE.connector * stateBoost * (1 + 0.1 * Math.min(c.recentTouches, 5));
    const verb = c.state === 'broken' || c.state === 'expired' ? 'Reconnect' : c.state === 'incomplete' ? 'Finish connecting' : 'Connect';
    // The kind, named the way every surface names it (`connectorKinds.ts`).
    const what = `the ${c.name} ${CONNECTOR_KIND_ONE[c.kind ?? 'team'].replace(/^an? /, '')}`;
    let hint: OpeningHint;
    if (input.person.isAdmin) {
      hint = {
        key: `connector:${c.slug}`,
        type: 'connector',
        label: `${verb} ${c.name} →`,
        reason: c.state === 'broken' || c.state === 'expired'
          ? `${capitalise(what)} stopped working${c.touchNote ? ` — ${c.touchNote}` : c.recentTouches > 0 ? ', and the team has needed it this week' : ''}.`
          : c.state === 'needed' ? (c.touchNote ? `${c.touchNote}.` : `${c.neededBy ?? 'An installed app'} reads from ${c.name}.`) : `${capitalise(what)} was started and not finished.`,
        score,
        action: { kind: 'send', prompt: `Help me ${verb.toLowerCase()} ${what}` },
      };
    } else if (c.recentTouches > 0) {
      // A member cannot connect it; say so only when it is getting in their way.
      hint = {
        key: `connector:${c.slug}`,
        type: 'connector',
        label: `Ask an admin to ${verb.toLowerCase()} ${c.name} →`,
        reason: `The team needed ${c.name} this week and ${what} isn't working.`,
        score: score * 0.6,
        action: { kind: 'send', prompt: `Ask an admin to ${verb.toLowerCase()} ${what}.` },
      };
    } else {
      continue;
    }
    if (!best || hint.score > best.score) {
      best = hint;
    }
  }
  return best;
}

function attentionCandidate(input: HintInput): OpeningHint | null {
  const n = input.waiting.length;
  if (n === 0) {
    return null;
  }
  const blocking = input.waiting.filter(w => w.blocksRun).length;
  const onlyFyi = input.waiting.every(w => w.kind === 'fyi');
  const stale = input.waiting.some(w => w.ageHours > 24);
  let score = BASE.attention + 8 * Math.min(n, 10);
  if (blocking > 0) {
    score *= 1.5;
  }
  if (stale) {
    score *= 1.2;
  }
  if (onlyFyi) {
    score *= 0.6;
  }
  return {
    key: 'attention',
    type: 'attention',
    label: `${n} ${plural(n, 'thing needs', 'things need')} your attention →`,
    reason: blocking > 0 ? `${blocking} ${plural(blocking, 'is', 'are')} holding up work until you decide.` : stale ? 'Some have waited more than a day.' : 'They are waiting on you in Review.',
    score,
    action: { kind: 'open', href: '/dashboard/inbox' },
  };
}

function nextCandidate(input: HintInput): OpeningHint | null {
  if (!input.next) {
    return null;
  }
  return {
    key: `next:${input.next.key}`,
    type: 'next',
    label: `${input.next.label} →`,
    reason: input.next.reason,
    score: BASE.next * (input.next.weight ?? 1),
    action: input.next.href ? { kind: 'open', href: input.next.href } : { kind: 'send', prompt: input.next.prompt },
  };
}

function capabilityCandidate(input: HintInput): OpeningHint | null {
  const { sessions, messagesSent } = input.person;
  const decay = sessions <= 1 ? 1 : sessions === 2 ? 0.7 : sessions === 3 ? 0.45 : 0.15;
  let score = BASE.capability * decay;
  if (messagesSent >= 5) {
    score *= 0.2;
  }
  if (input.now.getTime() - input.workspace.createdAt.getTime() < 14 * DAY) {
    score *= 1.2;
  }
  return {
    key: 'capability',
    type: 'capability',
    label: 'What can the team do? →',
    reason: `A short tour of what ${input.workspace.leadSpoken} and the team can take off your plate.`,
    score,
    action: { kind: 'send', prompt: 'What can you do?' },
  };
}

/**
 * The 0–2 hints an empty conversation shows, best first.
 * @param input - What the server knows about this person and workspace.
 */
export function openingHints(input: HintInput): OpeningHint[] {
  const recent = (type: HintType) => input.dismissed.filter(d => d.type === type && input.now.getTime() - d.at.getTime() < 30 * DAY).length;
  const hidden = new Set(input.dismissed.filter(d => input.now.getTime() - d.at.getTime() < DISMISS_DAYS * DAY).map(d => d.key));
  const candidates = [setupCandidate(input), connectorCandidate(input), attentionCandidate(input), nextCandidate(input), capabilityCandidate(input)]
    .filter((h): h is OpeningHint => h !== null && !hidden.has(h.key))
    .map(h => ({ ...h, score: Math.round(h.score * DISMISS_TYPE_DECAY ** recent(h.type) * 10) / 10 }))
    .filter(h => h.score >= HINT_FLOOR)
    .sort((a, b) => b.score - a.score);
  const [top, second] = candidates;
  if (!top) {
    return [];
  }
  return second && second.type !== top.type && second.score >= top.score * SECOND_HINT_SHARE ? [top, second] : [top];
}
