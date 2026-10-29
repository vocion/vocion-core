/**
 * A CONNECTION IS READ, NEVER TAKEN ON SOMEONE'S WORD.
 *
 * On 2026-10-29 a GitHub sign-in window closed before its callback reached
 * this deployment, and the connect card said so: "GitHub did not connect".
 * The person typed "It said it did connect". The reply ran Quick on the fast
 * model and answered "GitHub is now connected … the Software Factory can read
 * your repos" — false on both counts: no GitHub source existed, and that app
 * was not in the workspace.
 *
 * So whether a system is connected is never left to the model's reading of
 * the conversation. When this conversation put up a connect card (an
 * `offer_connection` card or a "Connect your systems" walk, both setup asks
 * here), every person's turn carries the live state of those systems, read
 * now: connected or not, and what the last sign-in did. A message that says
 * it connected gets the same read and a plain instruction for each case, and
 * keeps the turn off Quick (`effort.ts` `connectionFloor`).
 */

import type { AskOption } from '@/models/Schema';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { getConnector } from '@/libs/sources/registry';

/** How far back a connect card that was already settled still counts, in this conversation. */
export const ASKED_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The live state of one system, read at this turn. */
export type LiveConnection = {
  connector: string;
  name: string;
  connected: boolean;
  /** The newest sign-in that came back to this deployment, good or bad; null when none ever did. */
  attempt: { ok: boolean; at: Date; summary: string | null } | null;
  /** When this conversation last asked them to connect it. */
  askedAt: Date | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * The connectors a connect ask's options are for: `connect:<slug>` and
 * `paste:<slug>` (an `offer_connection` card), a link with `connector=` or
 * `add=` on it, and the systems a "Connect your systems" walk named. Pure.
 * @param options - The ask's options.
 */
export function connectorsOfOptions(options: readonly Pick<AskOption, 'id' | 'href'>[]): string[] {
  const out = new Set<string>();
  for (const option of options) {
    const byId = /^(?:connect|paste):([a-z0-9][a-z0-9-]*)$/.exec(option.id);
    if (byId) {
      out.add(byId[1]!);
    }
    const href = option.href;
    if (!href) {
      continue;
    }
    for (const slug of connectSystemsInputOfHref(href)?.named ?? []) {
      out.add(slug);
    }
    try {
      const url = new URL(href, 'http://in-app.invalid');
      const slug = url.searchParams.get('connector') ?? url.searchParams.get('add');
      if (slug && SLUG.test(slug)) {
        out.add(slug);
      }
    } catch {
      // Not a link: nothing to read.
    }
  }
  return [...out];
}

/**
 * Whether a message tells the agent a system is now connected or signed in
 * ("it connected", "done", "it said it did connect", "I logged in"). Pure; a
 * claim only ever raises how carefully the turn checks, never what it says.
 * @param message - What the person typed.
 */
export function claimsConnection(message: string): boolean {
  const text = message.toLowerCase().replace(/[’']/g, '\'').trim();
  if (!text || text.length > 280) {
    return false;
  }
  if (/\b(?:not|never|didn't|isn't|failed|fails|won't)\s(?:[^.?!]{0,30}\s)?(?:connect|sign|log|work)/.test(text) && !/\bsaid\b/.test(text)) {
    return false;
  }
  return /\b(?:connected|(?:it|that|github|this)\s+(?:did\s+)?connect|reconnected|signed in|logged in|installed|authori[sz]ed|it worked|that worked|all set|i'm in|done)\b/.test(text);
}

/**
 * What the turn reads: each system's live state, and what to do with a claim.
 * Pure. Empty when there is nothing to say.
 * @param live - The systems, read now.
 * @param opts - The turn.
 * @param opts.claimed - The message says it connected.
 * @param opts.now - Now, for "3 minutes ago".
 */
export function connectionTruthNote(live: readonly LiveConnection[], opts: { claimed: boolean; now?: Date }): string {
  if (live.length === 0) {
    return '';
  }
  const now = opts.now ?? new Date();
  const lines = live.map(c => `- ${connectionLine(c, now)}`);
  const out = [
    'CONNECTIONS, READ LIVE AT THIS TURN — the only source for whether these systems are connected, never the person\'s word or an earlier turn:',
    ...lines,
  ];
  const missing = live.filter(c => !c.connected);
  if (opts.claimed && missing.length > 0) {
    out.push(`They say it connected; the live state says ${missing.map(c => c.name).join(' and ')} did not. Say so plainly in one line with the reason above, and that the card is there to try again (call offer_connection for it if no card is docked). Never say it is connected, or that you can now read anything from it.`);
  } else if (missing.length > 0) {
    out.push('Never say a system above is connected, or that you can read from it, while it reads NOT connected.');
  }
  return out.join('\n');
}

/**
 * One system's state in one line: "GitHub (github): NOT connected. <why>".
 * @param c - The system, read now.
 * @param now - Now.
 */
export function connectionLine(c: LiveConnection, now: Date = new Date()): string {
  return c.connected ? `${c.name} (${c.connector}): connected.` : `${c.name} (${c.connector}): NOT connected. ${whyNot(c, now)}`;
}

/**
 * Why a system is not connected, from what the state shows.
 * @param c - The system.
 * @param now - Now.
 */
function whyNot(c: LiveConnection, now: Date): string {
  const sinceAsked = c.attempt && (!c.askedAt || c.attempt.at.getTime() >= c.askedAt.getTime() - 60_000);
  if (c.attempt && sinceAsked && !c.attempt.ok) {
    return `The last sign-in failed ${ago(c.attempt.at, now)}${c.attempt.summary ? `: ${c.attempt.summary.trim().replace(/\.$/, '')}` : ''}.`;
  }
  if (c.attempt && sinceAsked && c.attempt.ok) {
    return `A sign-in came back ${ago(c.attempt.at, now)}, but no source reads it yet: it still needs its settings saved, or the login was revoked.`;
  }
  if (!c.askedAt) {
    return 'No sign-in for it has ever come back to Vocion.';
  }
  return 'No sign-in for it has come back to Vocion since the card went up: the sign-in window was closed before it finished, or it finished somewhere else.';
}

/**
 * "3 minutes ago".
 * @param at - When.
 * @param now - Now.
 */
function ago(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 120) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  return `at ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The systems this conversation asked the person to connect: its open
 * connect asks, and those settled in the last few hours (a typed reply sets
 * a sign-in ask aside before the turn runs, so "open" alone would miss the
 * one the person is talking about). Newest ask first; each system once.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param now - Now.
 */
export async function connectorsAskedIn(orgId: string, conversationId: number, now: Date = new Date()): Promise<Map<string, Date>> {
  const [{ db }, { askSchema }, { and, desc, eq, gt, or }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const rows = await db
    .select({ options: askSchema.options, createdAt: askSchema.createdAt })
    .from(askSchema)
    .where(and(
      eq(askSchema.orgId, orgId),
      eq(askSchema.conversationId, conversationId),
      eq(askSchema.kind, 'setup'),
      or(eq(askSchema.status, 'open'), gt(askSchema.createdAt, new Date(now.getTime() - ASKED_WINDOW_MS))),
    ))
    .orderBy(desc(askSchema.createdAt))
    .limit(20);
  const asked = new Map<string, Date>();
  for (const row of rows) {
    for (const slug of connectorsOfOptions(row.options ?? [])) {
      if (!asked.has(slug) && getConnector(slug)) {
        asked.set(slug, row.createdAt);
      }
    }
  }
  return asked;
}

/**
 * Read each system's state now: a live source, and the newest sign-in that
 * came back.
 * @param orgId - The workspace.
 * @param asked - The systems, with when each was asked for.
 */
export async function liveConnections(orgId: string, asked: ReadonlyMap<string, Date | null>): Promise<LiveConnection[]> {
  if (asked.size === 0) {
    return [];
  }
  const [{ connectorHasLiveSource }, { lastConnectAttempts }] = await Promise.all([import('./createSourceOnLogin'), import('@/libs/connect/attempts')]);
  const attempts = await lastConnectAttempts(orgId).catch(() => new Map());
  return Promise.all([...asked].map(async ([connector, askedAt]) => {
    const attempt = attempts.get(connector);
    return {
      connector,
      name: getConnector(connector)?.name ?? connector,
      connected: await connectorHasLiveSource(orgId, connector),
      attempt: attempt ? { ok: attempt.ok, at: attempt.at, summary: attempt.summary } : null,
      askedAt,
    };
  }));
}

/**
 * The turn's connection note, for a person's turn in a conversation: the
 * live state of every system this conversation asked them to connect, and
 * whether their message claims one connected. Never throws.
 * @param opts - The turn.
 * @param opts.orgId - The workspace.
 * @param opts.conversationId - The conversation.
 * @param opts.message - What they typed.
 */
export async function connectionTurnNote(opts: { orgId: string; conversationId: number; message: string }): Promise<{ note: string; claimed: boolean }> {
  try {
    const asked = await connectorsAskedIn(opts.orgId, opts.conversationId);
    if (asked.size === 0) {
      return { note: '', claimed: false };
    }
    const claimed = claimsConnection(opts.message);
    const live = await liveConnections(opts.orgId, asked);
    return { note: connectionTruthNote(live, { claimed }), claimed };
  } catch (error) {
    console.warn('connectionTruth: could not read the live connection state', { orgId: opts.orgId, conversationId: opts.conversationId, message: (error as Error).message });
    return { note: '', claimed: false };
  }
}
