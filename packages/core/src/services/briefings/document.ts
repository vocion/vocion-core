/**
 * `BriefingV2` — the briefing as a typed document instead of a blob of
 * markdown (`docs/specs/briefing-v2.md`).
 *
 * The review's finding was structural, not cosmetic: the old briefing was a
 * markdown string the model wrote end to end, so every content rule — what
 * order the sections come in, how many items are above the fold, whether an
 * empty section renders, whether "On track" may sit next to "nothing ran" —
 * was a sentence in a prompt. This file makes them a contract.
 *
 * **Nine sections, this order, every one optional:**
 *
 *   1 today          the state of the business now — ≤5 metrics with deltas
 *   2 decisions      what only the human can decide — ≤3 unless an incident
 *   3 changes        what is materially different since the previous brief
 *   4 criticalPath   what is on the clock today, in time order
 *   5 exceptions     what is off-plan, contradictory, stalled or missing
 *   6 detail         the compact table you open when you want depth
 *   7 agentActivity  did the workforce operate correctly — only when it matters
 *   8 provenance     Sources & run details, collapsed
 *   9 history        the last 3–5 briefings, then "View all"
 *
 * A section that carries nothing is **absent**, never an empty state: the
 * renderer has no branch that draws "nothing happened" (spec §1). System
 * vocabulary — agent slugs, job and tool names, token counts, run ids,
 * connector fields, schema identifiers — is admissible only in sections 7
 * and 8 (spec §7–§9); `redactSystemVocabulary` enforces that over everything
 * else.
 *
 * Stored as JSON on `briefing.document`, beside the markdown it renders to,
 * so the page, the mail and the agent tools all read one source.
 */

import { z } from 'zod';
import { PROVENANCE_KINDS } from '@/libs/workspace/schemas';
import { INBOX_REF_KINDS } from '@/services/inbox/inboxRef';
import { INBOX_KINDS } from '@/services/inbox/kinds';

/** The nine sections, in the order the document renders them. Nothing else may be a section. */
export const BRIEFING_SECTIONS = ['today', 'decisions', 'changes', 'criticalPath', 'exceptions', 'detail', 'agentActivity', 'provenance', 'history'] as const;
export type BriefingSection = typeof BRIEFING_SECTIONS[number];

/** The human title of each section — one place, so the page and the mail cannot drift. */
export const SECTION_TITLE: Record<BriefingSection, string> = {
  today: 'Today',
  decisions: 'Needs your decision',
  changes: 'Changed since the last brief',
  criticalPath: 'Today’s critical path',
  exceptions: 'Risks & exceptions',
  detail: 'Pipeline detail',
  agentActivity: 'Agent activity',
  // Never "Evidence": run telemetry does not substantiate a business claim (spec §9).
  provenance: 'Sources & run details',
  history: 'Previous briefings',
};

const provenanceKind = z.enum([...PROVENANCE_KINDS]);
const inboxRefKind = z.enum([...INBOX_REF_KINDS]);
const inboxKind = z.enum([...INBOX_KINDS]);

/**
 * A pointer at the thing a claim rests on — a CRM record, a message, a call,
 * a contract, a team's own brief. Evidence attaches to the claim (spec §9),
 * which is why it is a ref and not a paragraph.
 */
export const RecordRefSchema = z.object({
  kind: z.string().min(1).describe('crm-deal | crm-company | email | call | contract | team-briefing | inbox | …'),
  id: z.string().min(1),
  label: z.string().min(1),
  href: z.string().optional(),
});
export type RecordRef = z.infer<typeof RecordRefSchema>;

/** Which way a delta moved. `flat` is a real answer; a missing direction means no prior value. */
export const METRIC_DIRECTIONS = ['up', 'down', 'flat'] as const;
export type MetricDirection = typeof METRIC_DIRECTIONS[number];

/**
 * Why a metric has no number. Rendered as *"<label> unavailable · Why?"* with
 * `detail` behind a disclosure — never as a zero, and never as the connector
 * field name in the narrative (spec §7).
 */
export const MetricUnavailableSchema = z.object({
  /** One clause a person reads: "Weighted forecast unavailable". */
  headline: z.string().min(1),
  /** The technical reason, shown only behind the disclosure. */
  detail: z.string().min(1),
});

/**
 * One `today` metric. `previous` is joined from the prior brief's metrics by
 * `key` (`deltas.ts`) — a typed join, never prose, and never a fabricated
 * zero when there is no prior brief.
 */
export const BriefingMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** Null only with `unavailable` set. */
  value: z.number().nullable(),
  unit: z.string().optional().describe('usd | count | pct | days | …'),
  previous: z.number().optional(),
  delta: z.number().optional(),
  direction: z.enum(METRIC_DIRECTIONS).optional(),
  provenance: provenanceKind,
  /** When a target exists for this metric's window — the only thing that licenses an on-track status. */
  target: z.number().optional(),
  unavailable: MetricUnavailableSchema.optional(),
  evidence: z.array(RecordRefSchema).default([]),
});
export type BriefingMetric = z.infer<typeof BriefingMetricSchema>;

/** The on-track verdict. `not-enough-evidence` is the default and it is not a colour. */
export const ON_TRACK_STATUSES = ['on-track', 'at-risk', 'off-track', 'not-enough-evidence'] as const;
export type OnTrackStatus = typeof ON_TRACK_STATUSES[number];

/**
 * "Are we on track?" — answerable only from a measure the system can see
 * (spec §3). `deriveOnTrack` in `onTrack.ts` is the only writer; a status
 * assembled by hand does not survive `validateBriefing`.
 */
export const OnTrackSchema = z.object({
  status: z.enum(ON_TRACK_STATUSES),
  /** The metric keys that licensed the verdict. Empty ⇒ `not-enough-evidence`. */
  basis: z.array(z.string().min(1)).default([]),
  /** True when the person has set a target, which is what lets the section say so out loud. */
  targetSet: z.boolean().default(false),
  note: z.string().optional(),
});
export type OnTrack = z.infer<typeof OnTrackSchema>;

export const TodaySchema = z.object({
  /** One sentence. The state of the business, not the state of the system. */
  summary: z.string().min(1).optional(),
  metrics: z.array(BriefingMetricSchema).default([]),
  onTrack: OnTrackSchema.optional(),
});
export type BriefingToday = z.infer<typeof TodaySchema>;

/**
 * Which lane a waiting decision falls in (spec §2). The split is computed
 * from the inbox's own kinds plus the alignment ledger — never authored.
 *
 *   judgment    only a person can answer: a ruling / approval / input /
 *               recommendation, or a proposal the person has not been
 *               agreeing with, or one carrying high risk
 *   batchable   a proposal of a kind this person approves almost every time
 *   background  everything else — it waits, and it is not the headline
 */
export const DECISION_LANES = ['judgment', 'batchable', 'background'] as const;
export type DecisionLane = typeof DECISION_LANES[number];

/**
 * One "Needs your decision" card. It is an inbox item: `ref`/`href` point at
 * the very row `/dashboard/inbox` would open, so the same decision goes to
 * the same place and there is no second decision UI.
 */
export const BriefingDecisionSchema = z.object({
  /** Stable key — `<refKind>:<id>`. */
  key: z.string().min(1),
  ref: z.object({ kind: inboxRefKind, id: z.number().int().positive() }),
  href: z.string().min(1),
  kind: inboxKind,
  title: z.string().min(1),
  /**
   * Why this matters NOW. "$450K contract unsigned" is data; "unsigned while
   * delivery has already started" is a briefing. Required, non-empty — a card
   * without it is rejected, not rendered with a blank line (spec §Content rules).
   */
  whyNow: z.string().min(1),
  evidence: z.array(RecordRefSchema).default([]),
  lane: z.enum(DECISION_LANES),
  /** The one thing that licenses a 4th card and beyond. */
  incident: z.boolean().default(false),
  /** Why it is an incident — the renderer says this out loud when it shows an over-budget card. */
  incidentReason: z.string().optional(),
  risk: z.string().nullable().default(null),
  amount: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  /** Who owns the follow-through, when it is a person or a team rather than the reader. */
  owner: z.string().optional(),
  waitingSince: z.coerce.date().optional(),
});
export type BriefingDecision = z.infer<typeof BriefingDecisionSchema>;

/**
 * Section 2. `queued` is the lower-priority remainder; the headline is
 * derived from these counts by `decisionHeadline`, never authored, so the raw
 * queue count can never become the headline (spec §2).
 */
export const DecisionsSchema = z.object({
  judgment: z.array(BriefingDecisionSchema).default([]),
  queued: z.object({
    batchable: z.number().int().nonnegative().default(0),
    background: z.number().int().nonnegative().default(0),
  }).default({ batchable: 0, background: 0 }),
  href: z.string().default('/dashboard/inbox'),
});
export type BriefingDecisions = z.infer<typeof DecisionsSchema>;

/**
 * One thing that is different since the previous brief. Computed by
 * `computeChanges` from the two briefs' metrics, then optionally narrated —
 * a change is never a sentence the model decided was interesting.
 */
export const BriefingChangeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  from: z.union([z.number(), z.string()]).nullable(),
  to: z.union([z.number(), z.string()]).nullable(),
  delta: z.number().optional(),
  direction: z.enum(METRIC_DIRECTIONS).optional(),
  unit: z.string().optional(),
  /** The model's one clause about what it means. Optional; the numbers stand alone. */
  narrative: z.string().optional(),
  provenance: provenanceKind,
  evidence: z.array(RecordRefSchema).default([]),
});
export type BriefingChange = z.infer<typeof BriefingChangeSchema>;

export const ChangesSchema = z.object({
  items: z.array(BriefingChangeSchema).default([]),
});

/** One thing on the clock today. `at` is a wall-clock label so the brief keeps its own timezone. */
export const CriticalPathItemSchema = z.object({
  at: z.string().min(1).describe('"11:30", "EOD", "12:30 PT"'),
  /**
   * The calendar date this item falls on, `YYYY-MM-DD`.
   *
   * A time of day is not a date, and this section is a claim about TODAY.
   * Without one, an item carried forward from a previous briefing is
   * indistinguishable from one happening in an hour — which is exactly how a
   * call from the previous day was served as "10:30am CT today" on
   * 2026-09-17. Optional in the type so briefings published before this
   * still parse; `enforceBriefing` drops any item that is not dated today,
   * because an undated claim about today cannot be checked by anyone.
   */
  date: z.string().optional().describe('REQUIRED in practice: the calendar date this is on, as YYYY-MM-DD. An item without it, or dated other than today, is dropped by the publisher — never carry an item forward from a previous briefing.'),
  /** Minutes from midnight — how the renderer orders the list, so ordering is not string sorting. */
  order: z.number().int().nonnegative(),
  label: z.string().min(1),
  status: z.string().optional().describe('held, outcome pending | confirmed | at risk'),
  owner: z.string().optional(),
  evidence: z.array(RecordRefSchema).default([]),
});
export type CriticalPathItem = z.infer<typeof CriticalPathItemSchema>;

export const CriticalPathSchema = z.object({
  items: z.array(CriticalPathItemSchema).default([]),
});

export const EXCEPTION_SEVERITIES = ['blocker', 'risk', 'missing'] as const;

/** Only actual exceptions. "No exceptions" is an absent section, not a line. */
export const BriefingExceptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  why: z.string().min(1),
  severity: z.enum(EXCEPTION_SEVERITIES),
  owner: z.string().optional(),
  evidence: z.array(RecordRefSchema).default([]),
});
export type BriefingException = z.infer<typeof BriefingExceptionSchema>;

export const ExceptionsSchema = z.object({
  items: z.array(BriefingExceptionSchema).default([]),
});

/** Section 6 — the compact table behind "View full pipeline ↓". */
export const DetailTableSchema = z.object({
  title: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(z.string())).default([]),
  note: z.string().optional(),
});

export type DetailTable = z.infer<typeof DetailTableSchema>;

export const DetailSchema = z.object({
  tables: z.array(DetailTableSchema).default([]),
});

/**
 * Why agent operations earned a line at all. An empty list means nothing
 * mattered, which means the section is omitted (spec §8) — a roster of zeroes
 * is not briefing content.
 */
export const AGENT_ACTIVITY_REASONS = ['failure', 'unusual-spend', 'stalled', 'missed-sla', 'human-intervention', 'major-outcome'] as const;
export type AgentActivityReason = typeof AGENT_ACTIVITY_REASONS[number];

export const AgentActivitySchema = z.object({
  /** The one line shown collapsed. */
  summary: z.string().min(1),
  reasons: z.array(z.enum(AGENT_ACTIVITY_REASONS)).min(1),
  /** The expansion. System vocabulary is allowed here and only here (with §8). */
  lines: z.array(z.string().min(1)).default([]),
});
export type BriefingAgentActivity = z.infer<typeof AgentActivitySchema>;

/** One source behind the brief — a connector read, a team's own brief, a run. */
export const BriefingSourceSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1).describe('connector | team-briefing | run | ledger'),
  provenance: provenanceKind.optional(),
  detail: z.string().optional(),
  href: z.string().optional(),
  asOf: z.coerce.date().optional(),
});
export type BriefingSource = z.infer<typeof BriefingSourceSchema>;

/**
 * Section 8 — collapsed by default. `footnotes` is where `redactSystemVocabulary`
 * parks the tokens it pulled out of the narrative, so the truth is never
 * deleted, only moved (manifesto §12).
 */
export const ProvenanceSchema = z.object({
  sources: z.array(BriefingSourceSchema).default([]),
  footnotes: z.array(z.object({
    marker: z.number().int().positive(),
    token: z.string().min(1),
    kind: z.string().min(1),
    note: z.string().optional(),
  })).default([]),
  /** Run telemetry, when there is any. Never named "evidence". */
  runs: z.object({ runs: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), spendCents: z.number().int().nonnegative() }).optional(),
});

export const HistoryEntrySchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  at: z.coerce.date(),
  href: z.string().min(1),
  teamSlug: z.string().nullable().default(null),
});
export type BriefingHistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistorySchema = z.object({
  entries: z.array(HistoryEntrySchema).default([]),
  viewAllHref: z.string().default('/dashboard/briefings/archive'),
  /** How many briefings exist in total, so "View all" can say what it opens. */
  total: z.number().int().nonnegative().default(0),
});

/**
 * The document. Every section optional; the renderer draws the ones that are
 * present, in `BRIEFING_SECTIONS` order, and nothing else.
 */
export const BriefingV2Schema = z.object({
  /** Bumped only when a stored document would need migrating. */
  version: z.literal(2).default(2),
  title: z.string().min(1),
  /** The brief's own date line — "Wed, Sep 16". */
  dateLabel: z.string().min(1),
  /** "Updated 5:15 AM PT". */
  updatedLabel: z.string().min(1),
  /** Which team this document belongs to; null = the workspace briefing. */
  teamSlug: z.string().nullable().default(null),
  /** The team briefings this one was composed FROM — sources, never inlined. */
  composedFrom: z.array(z.object({ briefingId: z.number().int().positive(), teamSlug: z.string(), teamName: z.string(), at: z.coerce.date() })).default([]),

  today: TodaySchema.optional(),
  decisions: DecisionsSchema.optional(),
  changes: ChangesSchema.optional(),
  criticalPath: CriticalPathSchema.optional(),
  exceptions: ExceptionsSchema.optional(),
  detail: DetailSchema.optional(),
  agentActivity: AgentActivitySchema.optional(),
  provenance: ProvenanceSchema.optional(),
  history: HistorySchema.optional(),
});

export type BriefingV2 = z.infer<typeof BriefingV2Schema>;

/** The sections a person reads as prose — everything system vocabulary is banned from. */
export const NARRATIVE_SECTIONS: readonly BriefingSection[] = ['today', 'decisions', 'changes', 'criticalPath', 'exceptions', 'detail'];

/**
 * Whether a section carries anything worth drawing. The renderer asks this
 * and nothing else; there is no "empty state" branch to reach.
 * @param doc - The document.
 * @param section - Which section.
 */
export function hasContent(doc: BriefingV2, section: BriefingSection): boolean {
  switch (section) {
    case 'today': {
      const t = doc.today;
      // An on-track verdict of `not-enough-evidence` with no target is not content.
      return !!t && (t.metrics.length > 0 || !!t.summary || (!!t.onTrack && (t.onTrack.status !== 'not-enough-evidence' || t.onTrack.targetSet)));
    }
    case 'decisions':
      return !!doc.decisions && (doc.decisions.judgment.length > 0 || doc.decisions.queued.batchable + doc.decisions.queued.background > 0);
    case 'changes':
      return (doc.changes?.items.length ?? 0) > 0;
    case 'criticalPath':
      return (doc.criticalPath?.items.length ?? 0) > 0;
    case 'exceptions':
      return (doc.exceptions?.items.length ?? 0) > 0;
    case 'detail':
      return (doc.detail?.tables ?? []).some(t => t.rows.length > 0);
    case 'agentActivity':
      return !!doc.agentActivity && doc.agentActivity.reasons.length > 0;
    case 'provenance':
      return !!doc.provenance && (doc.provenance.sources.length > 0 || doc.provenance.footnotes.length > 0 || !!doc.provenance.runs);
    case 'history':
      return (doc.history?.entries.length ?? 0) > 0;
  }
}

/**
 * The sections this document actually renders, in order. The ONE place that
 * decides presence and order — not the model, not the page.
 * @param doc - The document.
 */
export function renderedSections(doc: BriefingV2): BriefingSection[] {
  return BRIEFING_SECTIONS.filter(s => hasContent(doc, s));
}
