/**
 * What the evidence says, before anyone judges it — typed findings derived by
 * code from the signals, each naming the changes it could justify and the
 * evidence a person reads on the card.
 *
 * Pure: signals in, findings out. Every threshold is a number on a typed
 * field — days since a run, a rejection rate, an attainment — and nothing here
 * reads a person's words or an agent's reply (CLAUDE.md: meaning is read by a
 * model, never matched). What a finding WARRANTS is the judge's call
 * (`judge.ts`); a finding whose change code can state on its own carries a
 * `fallback`, filed when the judge is unavailable, so a review never ends
 * silently just because a model call failed.
 */

import type { AgentSignals, OrgSignals, TeamSignals } from './signals';
import type { OrgChange, OrgChangeKind, OrgEvidenceItem, OrgSignal } from '@/libs/actions/org-change';
import type { ResolvedOrgReviewConfig } from '@/libs/orgReview/config';

const DAY_MS = 86_400_000;

/** Decisions on one kind before a rejection rate means anything. */
export const MIN_DECISIONS = 3;
/** Rejections on one kind, in the window, that make a pattern. */
export const MIN_REJECTIONS = 3;
/** The share of decisions rejected at which a kind is a pattern rather than noise. */
export const REJECTION_RATE = 0.5;
/** Asks filed in the window that read as escalating by habit. */
export const MIN_ESCALATIONS = 5;
/** Agreement above which an agent hitting its cap is doing work people want. */
export const GOOD_AGREEMENT = 0.8;
/** Agreement below which spend is buying work people turn down. */
export const POOR_AGREEMENT = 0.5;
/** Decisions with a recommendation before agreement is read at all. */
export const MIN_AGREEMENT_N = 5;
/** Spend in the window below which "poor return" is not worth a card, cents. */
export const MIN_SPEND_CENTS = 500;
/** Attainment below which a team is behind. */
export const BEHIND_ATTAINMENT = 0.5;
/** Default allowance a hire is offered at, cents a day. */
export const DEFAULT_HIRE_CENTS = 2_000;

export type Finding = {
  /** Stable within one review: `<signal>:<target>`. */
  id: string;
  signal: OrgSignal;
  agentSlug?: string;
  teamSlug?: string;
  /** Orders findings: the strongest are judged and filed first. */
  strength: number;
  /** One line naming what was found, for the judge and the logs. */
  summary: string;
  /** Typed facts, one per line, for the judge. Never shown as evidence. */
  facts: string[];
  /** What a person reads on the card, each line linked to where they can check it. */
  evidence: OrgEvidenceItem[];
  /** The changes this finding could justify; the judge may choose none of them. */
  allowed: OrgChangeKind[];
  /** For a `hire_agent`: the roles the judge may choose from. */
  catalog?: Array<{ slug: string; name: string; description: string }>;
  /** The agent's daily cap in force, cents, for a `set_budget`. */
  currentDailyCents?: number | null;
  /** What code files when no judgement is available, or null when only a judge can say. */
  fallback: { change: OrgChange; headline: string; reason: string } | null;
};

function days(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Round to whole dollars, never below one.
 * @param cents - An amount in cents.
 */
function dollars(cents: number): number {
  return Math.max(100, Math.round(cents / 100) * 100);
}

function memberHref(slug: string): string {
  return `/dashboard/team-report/${encodeURIComponent(slug)}`;
}

function decidedHref(slug: string, actionKind?: string): string {
  const q = new URLSearchParams({ tab: 'decided', kind: 'proposal', agents: slug });
  if (actionKind) {
    q.set('actionKind', actionKind);
  }
  return `/dashboard/inbox?${q.toString()}`;
}

function agreementOf(a: AgentSignals): { n: number; rate: number | null } {
  const n = a.decisions.reduce((s, d) => s + d.withRecommendation, 0);
  const agreed = a.decisions.reduce((s, d) => s + d.agreed, 0);
  return { n, rate: n > 0 ? agreed / n : null };
}

/**
 * An agent with no sign of work for `idleDays` — never the workspace lead,
 * never one younger than the window.
 * @param a - The agent.
 * @param idleDays - The window.
 * @param now - The clock.
 */
function idleFinding(a: AgentSignals, idleDays: number, now: Date): Finding | null {
  if (a.isWorkspaceLead) {
    return null;
  }
  const cutoff = now.getTime() - idleDays * DAY_MS;
  if (a.createdAt.getTime() > cutoff) {
    return null;
  }
  if (a.lastActiveAt && a.lastActiveAt.getTime() > cutoff) {
    return null;
  }
  const quietDays = days(now.getTime() - (a.lastActiveAt ?? a.createdAt).getTime());
  const last = a.lastActiveAt ? `${day(a.lastActiveAt)} (${days(now.getTime() - a.lastActiveAt.getTime())} days ago)` : 'never';
  return {
    id: `idle:${a.slug}`,
    signal: 'idle',
    agentSlug: a.slug,
    strength: 100 + quietDays,
    summary: `${a.name} has not run since ${last}`,
    facts: [
      `last run: ${last}`,
      `created: ${day(a.createdAt)}`,
      `assistant turns, worker runs in the window: ${a.turns}, ${a.workerRuns}`,
      a.description ? `what it is for: ${a.description}` : 'no description',
    ],
    evidence: [
      { label: 'Last run', value: last, href: memberHref(a.slug) },
      { label: 'On the team since', value: day(a.createdAt), href: `/dashboard/agents/${encodeURIComponent(a.slug)}` },
      { label: 'Work in the window', value: `${a.turns} turns, ${a.workerRuns} runs, ${a.decisions.reduce((n, d) => n + d.decided, 0)} decided proposals` },
    ],
    allowed: ['retire_agent'],
    fallback: {
      change: { kind: 'retire_agent', agentSlug: a.slug },
      headline: `Retire ${a.name} — no runs in ${quietDays} days`,
      reason: `${a.name} has not run since ${last}, past this workspace's ${idleDays}-day idle window. Retiring it keeps the roster honest; Undo brings it back as it was.`,
    },
  };
}

/**
 * Spend that is not paying: an agent at its cap whose work people accept
 * (raise it), or one spending real money on work people turn down (cut it).
 * @param a - The agent.
 * @param windowDays - The window the spend covers.
 */
function spendFinding(a: AgentSignals, windowDays: number): Finding | null {
  const agreement = agreementOf(a);
  const cap = a.today?.hardCentsLimit ?? null;
  const read = agreement.rate !== null && agreement.n >= MIN_AGREEMENT_N;
  const atCapAndGood = Boolean(a.today?.blocked) && read && agreement.rate! >= GOOD_AGREEMENT && cap !== null;
  const poorReturn = read && agreement.rate! < POOR_AGREEMENT && a.spentCents >= MIN_SPEND_CENTS;
  if (!atCapAndGood && !poorReturn) {
    return null;
  }
  const evidence: OrgEvidenceItem[] = [
    { label: `Spend, last ${windowDays} days`, value: money(a.spentCents), href: memberHref(a.slug) },
    { label: 'Today', value: a.today ? `${money(a.today.spentCents)} of ${a.today.hardCentsLimit === null ? 'no cap' : money(a.today.hardCentsLimit)}${a.today.blocked ? ' — at its cap' : ''}` : 'no reading' },
    { label: 'Agrees with you', value: `${pct(agreement.rate!)} of ${agreement.n} decided recommendations`, href: decidedHref(a.slug) },
  ];
  const facts = [
    `spend in the window: ${money(a.spentCents)}`,
    `today: ${evidence[1]!.value}`,
    `agreement: ${pct(agreement.rate!)} (n=${agreement.n})`,
    a.refusedTurns > 0 ? `turns refused (a budget stop is one): ${a.refusedTurns}` : 'no refused turns',
  ];
  if (atCapAndGood) {
    const next = dollars(cap! * 1.5);
    return {
      id: `spend:${a.slug}`,
      signal: 'spend',
      agentSlug: a.slug,
      strength: 60 + agreement.n,
      summary: `${a.name} hit its ${money(cap!)} daily cap while people agree with ${pct(agreement.rate!)} of its work`,
      facts,
      evidence,
      allowed: ['set_budget'],
      currentDailyCents: cap,
      fallback: {
        change: { kind: 'set_budget', agentSlug: a.slug, dailyCents: next },
        headline: `Raise ${a.name}'s daily cap to ${money(next)}`,
        reason: `${a.name} is at its ${money(cap!)} daily cap and people agreed with ${pct(agreement.rate!)} of ${agreement.n} recommendations in ${windowDays} days, so the cap is stopping work people want.`,
      },
    };
  }
  const next = cap === null ? null : dollars(cap / 2);
  return {
    id: `spend:${a.slug}`,
    signal: 'spend',
    agentSlug: a.slug,
    strength: 50 + Math.round((1 - agreement.rate!) * 40),
    summary: `${a.name} spent ${money(a.spentCents)} on work people agreed with ${pct(agreement.rate!)} of the time`,
    facts,
    evidence,
    allowed: ['set_budget', 'retire_agent', 'adopt_rule'],
    currentDailyCents: cap,
    fallback: next === null
      ? null
      : {
          change: { kind: 'set_budget', agentSlug: a.slug, dailyCents: next },
          headline: `Halve ${a.name}'s daily cap to ${money(next)}`,
          reason: `${a.name} spent ${money(a.spentCents)} in ${windowDays} days and people agreed with only ${pct(agreement.rate!)} of ${agreement.n} recommendations. A smaller allowance limits the cost while its rules catch up.`,
        },
  };
}

/**
 * A kind of proposal people keep turning down, with the notes they left — the
 * raw material of a standing rule. Without notes there is nothing to write a
 * rule from, so nothing is found.
 * @param a - The agent.
 * @param windowDays - The window.
 */
function rejectionFindings(a: AgentSignals, windowDays: number): Finding[] {
  if (a.rejectionNotes.length === 0) {
    return [];
  }
  return a.decisions
    .filter(d => d.decided >= MIN_DECISIONS && d.rejected >= MIN_REJECTIONS && d.rejected / d.decided >= REJECTION_RATE)
    .map(d => ({
      id: `rejections:${a.slug}:${d.subjectKey}`,
      signal: 'rejections' as const,
      agentSlug: a.slug,
      strength: 70 + d.rejected,
      summary: `${a.name}'s ${d.subjectKey} proposals were turned down ${d.rejected} of ${d.decided} times`,
      facts: [
        `kind: ${d.subjectKey}; decided ${d.decided}, rejected ${d.rejected} in ${windowDays} days`,
        ...a.rejectionNotes.map(n => `rejection note — ${n}`),
      ],
      evidence: [
        { label: 'Turned down', value: `${d.rejected} of ${d.decided} ${d.subjectKey} proposals in ${windowDays} days`, href: decidedHref(a.slug, d.subjectKey) },
        { label: 'Latest reason given', value: a.rejectionNotes[0]!.slice(0, 300) },
      ],
      allowed: ['adopt_rule'] as OrgChangeKind[],
      fallback: null,
    }));
}

/**
 * An agent asking people the same kind of thing again and again, with the
 * answers they gave — what a standing rule could answer in advance.
 * @param a - The agent.
 * @param windowDays - The window.
 */
function escalationFinding(a: AgentSignals, windowDays: number): Finding | null {
  if (a.asks.filed < MIN_ESCALATIONS || a.answeredAsks.length === 0) {
    return null;
  }
  const kinds = Object.entries(a.asks.byKind).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k}`).join(', ');
  return {
    id: `escalations:${a.slug}`,
    signal: 'escalations',
    agentSlug: a.slug,
    strength: 40 + a.asks.filed,
    summary: `${a.name} filed ${a.asks.filed} asks in ${windowDays} days`,
    facts: [
      `asks filed: ${a.asks.filed} (${kinds}); answered: ${a.asks.answered}`,
      ...a.answeredAsks.map(q => `asked "${q.title}" — answered ${q.decision ?? 'unknown'}${q.note ? `: ${q.note}` : ''}`),
    ],
    evidence: [
      { label: 'Asks filed', value: `${a.asks.filed} in ${windowDays} days (${kinds})`, href: `/dashboard/inbox?tab=decided&agents=${encodeURIComponent(a.slug)}` },
      { label: 'Latest asked', value: `“${a.answeredAsks[0]!.title}” — ${a.answeredAsks[0]!.decision ?? 'answered'}` },
    ],
    allowed: ['adopt_rule'],
    fallback: null,
  };
}

/**
 * A team behind on its primary measure with catalog roles it has not hired.
 * @param t - The team.
 */
function measureFinding(t: TeamSignals): Finding | null {
  if (!t.primary || t.primary.attainment >= BEHIND_ATTAINMENT || t.unhired.length === 0) {
    return null;
  }
  const unit = t.primary.unit ? ` ${t.primary.unit}` : '';
  const reading = `${t.primary.value}${unit} of ${t.primary.target}${unit} (${pct(t.primary.attainment)}) over ${t.primary.window} — ${t.primary.provenance}`;
  return {
    id: `measures:${t.slug}`,
    signal: 'measures',
    teamSlug: t.slug,
    strength: 30 + Math.round((1 - t.primary.attainment) * 20),
    summary: `${t.name} is at ${pct(t.primary.attainment)} of its ${t.primary.label} target`,
    facts: [
      `team: ${t.name}${t.goal ? ` — ${t.goal}` : ''}`,
      `primary measure: ${t.primary.label}: ${reading}`,
      `members: ${t.agentSlugs.join(', ') || 'none'}`,
    ],
    evidence: [
      { label: t.primary.label, value: reading, href: '/dashboard/team-report' },
      { label: 'On the team', value: t.agentSlugs.length > 0 ? t.agentSlugs.join(', ') : 'nobody yet', href: '/dashboard/teams' },
    ],
    allowed: ['hire_agent'],
    catalog: t.unhired,
    fallback: null,
  };
}

/**
 * Every finding in the signals, strongest first.
 * @param signals - What the review read.
 * @param config - The workspace's review settings.
 */
export function deriveFindings(signals: OrgSignals, config: Pick<ResolvedOrgReviewConfig, 'idleDays'>): Finding[] {
  const out: Finding[] = [];
  for (const a of signals.agents) {
    const idle = idleFinding(a, config.idleDays, signals.asOf);
    if (idle) {
      // An idle agent's other signals are stale by definition; one card.
      out.push(idle);
      continue;
    }
    const spend = spendFinding(a, signals.windowDays);
    if (spend) {
      out.push(spend);
    }
    out.push(...rejectionFindings(a, signals.windowDays));
    const escalation = escalationFinding(a, signals.windowDays);
    if (escalation) {
      out.push(escalation);
    }
  }
  for (const t of signals.teams) {
    const finding = measureFinding(t);
    if (finding) {
      out.push(finding);
    }
  }
  return out.sort((x, y) => y.strength - x.strength || x.id.localeCompare(y.id));
}
