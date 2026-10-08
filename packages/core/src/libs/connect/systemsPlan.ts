/**
 * "CONNECT YOUR SYSTEMS" — the typed plan the walk-through runs on.
 *
 * Pure types and pure helpers, shared by the server that builds the plan
 * (`services/connect/recommendations.ts`), the chat tool that offers it
 * (`connect_system`) and the docked flow that walks it
 * (`features/dashboard/connect-systems`). Nothing here names a vendor: every
 * entry is read from the platform registry (`libs/platforms/registry.ts`) and
 * the connector registry (`libs/sources/registry.ts`), so a connector added
 * there is offered here with no change.
 *
 * Self-contained on purpose: the flow is one objective with a progress line
 * ("Connect your systems · 2 of 5"), so it can be wrapped as a Decision
 * objective later without reshaping it.
 */

import type { ConfigField } from '@/libs/sources/configFields';

/** Why a system is on the list, as one typed piece of evidence. */
export type ConnectEvidence
  = | { kind: 'named' }
    | { kind: 'app'; app: string; appName: string; needed: boolean }
    | { kind: 'mail'; domain: string }
    | { kind: 'org'; workspaces: number };

/** How the person connects it from the flow. */
export type ConnectMethod
  = | { kind: 'login'; startHref: string; providerLabel: string; settingsAfterLogin: ConfigField[] }
    | { kind: 'key'; credentialLabel: string; credentialFields: Array<{ name: string; label: string; secret: boolean; optional: boolean; hint: string }>; configFields: ConfigField[]; getItAt: { url: string; steps: string[] } | null }
    | { kind: 'page'; href: string };

/** What connecting it lets the workspace do, from an app that reads it. */
export type ConnectUnlock = { app: string; appName: string; href: string; added: boolean; features: string[] };

/** One system on the list. */
export type ConnectCandidate = {
  connector: string;
  name: string;
  /** The ranking score; higher is offered first. Shown nowhere, kept for tests and traces. */
  score: number;
  /** True when the evidence is strong enough to preselect it. */
  recommended: boolean;
  evidence: ConnectEvidence[];
  method: ConnectMethod;
  unlocks: ConnectUnlock[];
};

/** The question, when one is needed, and the systems it offers. */
export type ConnectQuestion = { question: string; options: string[] };

export type ConnectPlan = {
  /** The ranked systems still to connect. */
  candidates: ConnectCandidate[];
  /** The systems this workspace already reads. */
  connected: Array<{ connector: string; name: string }>;
  /** Set when the flow should ask "Which of these do you use?" before walking. */
  question: ConnectQuestion | null;
  /** The scope the plan was built for, for its title: an app's name, or null for the whole workspace. */
  scope: { app: string; appName: string } | null;
  /** Why nothing can be connected here (not an admin), worded for a person. */
  refused: string | null;
};

/** What the flow was asked to do: everything, one app's systems, or what the person named. */
export type ConnectPlanInput = {
  /** Connector slugs the person named (read by the agent from their words, never matched here). */
  named?: string[];
  /** An app id: plan only the systems that app reads. */
  app?: string;
};

/** What a verification found. */
export type ConnectVerification
  = | { state: 'verified'; preview: string | null; checks: string[] }
    | { state: 'reading'; preview: string | null }
    | { state: 'failed'; reason: string }
    | { state: 'missing'; reason: string };

/** Each system's outcome, for the summary. */
export type ConnectOutcome = 'connected' | 'skipped' | 'later' | 'failed';

/**
 * One line of evidence, in words. Shown under a step so the person can see
 * why it was offered (principle 10).
 * @param e - The evidence.
 */
export function evidenceLine(e: ConnectEvidence): string {
  switch (e.kind) {
    case 'named':
      return 'You named it';
    case 'app':
      return e.needed ? `${e.appName} needs it` : `${e.appName} reads it`;
    case 'mail':
      return `Mail at ${e.domain} is hosted there`;
    case 'org':
      return e.workspaces === 1 ? 'Used in another workspace of your Org' : `Used in ${e.workspaces} other workspaces of your Org`;
  }
}

/**
 * "Found 1,284 deals" — a count in the noun the connector counts in.
 * @param count - How many.
 * @param noun - Singular and plural.
 * @param noun.one - One of it.
 * @param noun.other - Several.
 */
export function foundLine(count: number, noun: { one: string; other: string }): string {
  return `Found ${count.toLocaleString('en-US')} ${count === 1 ? noun.one : noun.other}`;
}

/**
 * The summary's verdict on each system, in one line: what it unlocks once
 * connected, or what happened instead.
 * @param candidate - The system.
 * @param outcome - What became of it.
 */
export function unlockLine(candidate: ConnectCandidate, outcome: ConnectOutcome): string {
  if (outcome !== 'connected') {
    return outcome === 'later' ? 'Put off for later' : outcome === 'failed' ? 'Did not connect' : 'Skipped';
  }
  if (candidate.unlocks.length === 0) {
    return 'Agents can search it now';
  }
  return candidate.unlocks
    .map(u => (u.features.length > 0 ? `${u.appName}: ${u.features.join(', ')}` : `${u.appName} can read it`))
    .join(' · ');
}
