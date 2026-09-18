/**
 * The database half of briefing v2: reading a stored document, finding the
 * brief it should compute deltas against, building the history preview, and
 * composing a workspace brief out of the teams' own.
 *
 * Everything shaped lives in the pure modules beside this one. This file only
 * does I/O, so the contract, the budgets and the ranking stay unit-testable
 * without a database.
 */

import type { PublishBriefingInput } from './agentInput';
import type { TeamBriefingSource } from './compose';
import type { BriefingDecision, BriefingHistoryEntry, BriefingV2 } from './document';
import type { RedactionVocabulary } from './redact';
import type { BriefingIssue } from './validate';
import type { AlignmentScore } from '@/services/alignment/AlignmentService';
import type { InboxItem } from '@/services/InboxService';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, briefingSchema, teamSchema } from '@/models/Schema';
import { scoresByKey } from '@/services/alignment/AlignmentService';
import { listInbox } from '@/services/InboxService';
import { builtInJobNames } from '@/services/jobs/registry';
import { briefingLabels } from './agentInput';
import { MAX_HISTORY_ENTRIES } from './budget';
import { composeWorkspaceBriefing } from './compose';
import { fallbackWhyNow, rankDecisions, splitLanes, toDecisionCard } from './decisions';
import { BriefingV2Schema } from './document';
import { briefingHref } from './links';
import { renderBriefingMarkdown } from './render';
import { replacesPrior } from './republish';
import { briefingTitle } from './title';
import { assertBriefingV2 } from './validate';

export type StoredBriefing = {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
  teamSlug: string | null;
  agentSlug: string | null;
  /** Who published — `agent:<slug>`, `job:<name>`, or a user id. */
  publishedBy: string | null;
  /** The typed document, when the row carries one. Null on pre-v2 rows. */
  document: BriefingV2 | null;
};

/**
 * Parse a stored document. A row whose JSON no longer satisfies the contract
 * reads as `null` — the page then renders the markdown, which is always
 * there, rather than throwing on a page load.
 * @param raw - The `document` column.
 */
export function parseStoredDocument(raw: unknown): BriefingV2 | null {
  if (raw == null) {
    return null;
  }
  const parsed = BriefingV2Schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const COLUMNS = {
  id: briefingSchema.id,
  title: briefingSchema.title,
  content: briefingSchema.content,
  createdAt: briefingSchema.createdAt,
  teamSlug: briefingSchema.teamSlug,
  agentSlug: briefingSchema.agentSlug,
  publishedBy: briefingSchema.publishedBy,
  document: briefingSchema.document,
};

function toStored(row: { id: number; title: string; content: string; createdAt: Date; teamSlug: string | null; agentSlug: string | null; publishedBy: string | null; document: unknown }): StoredBriefing {
  return { ...row, document: parseStoredDocument(row.document) };
}

/**
 * One brief by id, scoped to the org.
 * @param orgId - Tenant.
 * @param id - Briefing id.
 */
export async function getBriefing(orgId: string, id: number): Promise<StoredBriefing | null> {
  const [row] = await db.select(COLUMNS).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, id))).limit(1);
  return row ? toStored(row) : null;
}

/**
 * The latest brief for a scope — `null` teamSlug is the workspace brief.
 * @param orgId - Tenant.
 * @param teamSlug - Scope; null = the workspace brief.
 */
export async function latestBriefing(orgId: string, teamSlug: string | null): Promise<StoredBriefing | null> {
  const [row] = await db.select(COLUMNS).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), teamSlug === null ? isNull(briefingSchema.teamSlug) : eq(briefingSchema.teamSlug, teamSlug))).orderBy(desc(briefingSchema.createdAt)).limit(1);
  return row ? toStored(row) : null;
}

/**
 * The newest brief in ANY scope — so a reader of a stale rollup can be told
 * that a team published this morning. On 2026-09-18 the workspace lead read
 * Thursday's rollup and called the day from the calendar while the revops
 * team's Friday brief sat unread one scope over.
 * @param orgId - Tenant.
 */
export async function newestBriefing(orgId: string): Promise<StoredBriefing | null> {
  const [row] = await db.select(COLUMNS).from(briefingSchema).where(eq(briefingSchema.orgId, orgId)).orderBy(desc(briefingSchema.createdAt)).limit(1);
  return row ? toStored(row) : null;
}

/**
 * The brief a new one computes its deltas against: the previous brief in the
 * SAME scope. Same scope matters — a workspace brief compared against a
 * team's would compute nonsense deltas on keys that mean different things.
 * @param orgId - Tenant.
 * @param teamSlug - Scope; null = the workspace brief.
 * @param before - Only briefs older than this. Defaults to now.
 */
export async function priorBriefing(orgId: string, teamSlug: string | null, before: Date = new Date()): Promise<StoredBriefing | null> {
  const [row] = await db.select(COLUMNS).from(briefingSchema).where(and(
    eq(briefingSchema.orgId, orgId),
    teamSlug === null ? isNull(briefingSchema.teamSlug) : eq(briefingSchema.teamSlug, teamSlug),
    lt(briefingSchema.createdAt, before),
  )).orderBy(desc(briefingSchema.createdAt)).limit(1);
  return row ? toStored(row) : null;
}

/**
 * The last few briefs in a scope, plus how many there are in all — section 9
 * is a preview with a link, never the archive itself (spec §10).
 * @param orgId - Tenant.
 * @param teamSlug - Scope.
 * @param opts - Which brief to leave out (the one being rendered) and how many to take.
 * @param opts.excludeId - The brief being rendered.
 * @param opts.limit - How many entries.
 */
export async function briefingHistory(
  orgId: string,
  teamSlug: string | null,
  opts: { excludeId?: number; limit?: number } = {},
): Promise<{ entries: Array<BriefingHistoryEntry & { agentSlug: string | null }>; total: number }> {
  const scope = and(eq(briefingSchema.orgId, orgId), teamSlug === null ? isNull(briefingSchema.teamSlug) : eq(briefingSchema.teamSlug, teamSlug));
  const [rows, [counted]] = await Promise.all([
    db.select({ id: briefingSchema.id, title: briefingSchema.title, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug, agentSlug: briefingSchema.agentSlug })
      .from(briefingSchema)
      .where(scope)
      .orderBy(desc(briefingSchema.createdAt))
      .limit((opts.limit ?? MAX_HISTORY_ENTRIES) + 1),
    db.select({ n: sql<number>`count(*)::int` }).from(briefingSchema).where(scope),
  ]);
  const entries = rows
    .filter(r => r.id !== opts.excludeId)
    .slice(0, opts.limit ?? MAX_HISTORY_ENTRIES)
    .map(r => ({ id: r.id, title: r.title, at: r.createdAt, href: briefingHref(r.id), teamSlug: r.teamSlug, agentSlug: r.agentSlug }));
  return { entries, total: counted?.n ?? entries.length };
}

/**
 * Display names for agent slugs, so a page can say *by Revenue Director*
 * rather than `revenue-director` (spec §7: system vocabulary stays off the
 * narrative). A slug with no agent row maps to itself.
 * @param orgId - Tenant.
 * @param slugs - Agent slugs to resolve.
 */
export async function agentNames(orgId: string, slugs: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(slugs.filter((s): s is string => typeof s === 'string' && s.length > 0))];
  const out = new Map<string, string>();
  if (wanted.length === 0) {
    return out;
  }
  const rows = await db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, wanted)));
  for (const r of rows) {
    out.set(r.slug, r.name ?? r.slug);
  }
  return out;
}

/**
 * The workspace's own names, so the redaction pass knows which hyphenated
 * words are agent slugs and which are English. Tool and table names are
 * caught by shape (`snake_case`) and need no list.
 * @param orgId - Tenant.
 */
export async function workspaceVocabulary(orgId: string): Promise<RedactionVocabulary> {
  const agents = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, orgId));
  return { agents: agents.map(a => a.slug), jobs: builtInJobNames() };
}

/**
 * The "Needs your decision" section, from the live inbox.
 *
 * The cards ARE inbox rows: the lane split uses the inbox's own kinds and the
 * alignment ledger, and each card's href is the row's own detail route. The
 * `whyNow` for a card comes from `whyNow[item.key]` when the composing agent
 * supplied one and from the row itself otherwise — it is never blank and
 * never invented.
 * @param orgId - Tenant.
 * @param opts - The model's why-now clauses and the incident marking.
 * @param opts.whyNow - `item.key` → why this matters now.
 * @param opts.incidents - Keys the caller considers a genuine incident, with the reason.
 * @param opts.now - The clock.
 */
export async function decisionsSection(
  orgId: string,
  opts: { whyNow?: Record<string, string>; incidents?: Record<string, string>; now?: Date } = {},
): Promise<{ judgment: BriefingDecision[]; queued: { batchable: number; background: number } }> {
  const now = opts.now ?? new Date();
  const [inbox, alignment] = await Promise.all([
    listInbox(orgId, { tab: 'open' }),
    scoresByKey(orgId, '30d', now).catch(() => new Map<string, AlignmentScore>()),
  ]);
  const lanes = splitLanes(inbox.items, alignment);
  const incidents = opts.incidents ?? {};
  const isIncident = (item: InboxItem) => Boolean(incidents[item.key]);
  const ranked = rankDecisions(lanes.judgment, isIncident, now);

  const judgment = ranked
    .map(item => toDecisionCard(
      item,
      opts.whyNow?.[item.key]?.trim() || fallbackWhyNow(item, now),
      {
        lane: 'judgment',
        ...(incidents[item.key] ? { incident: true, incidentReason: incidents[item.key]! } : {}),
        evidence: item.subline ? [{ kind: 'inbox', id: item.key, label: item.subline, href: item.href }] : [],
      },
    ))
    .filter((c): c is BriefingDecision => c !== null);

  // A sheet row opens several things at once and is not a card, but it is
  // still work waiting — it counts in the queue rather than vanishing.
  const cardless = ranked.length - judgment.length;
  return {
    judgment,
    queued: { batchable: lanes.batchable.length, background: lanes.background.length + cardless },
  };
}

/**
 * Build and store one briefing from what an agent supplied.
 *
 * This is the whole "structural, not prompted" seam: the agent's tool call
 * carries observations and judgement; everything that decides what a person
 * sees — section presence and order, the delta join, the on-track verdict,
 * the decision lanes and their budget, the redaction, the history, the
 * sources — happens here, after the model has stopped talking.
 * @param orgId - Tenant.
 * @param input - What the agent supplied, already parsed.
 * @param opts - Publisher identity and scope.
 * @param opts.teamSlug - The scope this brief belongs to; null = the workspace brief.
 * @param opts.agentSlug - Publisher.
 * @param opts.userId - Publisher, when a person triggered it.
 * @param opts.now - The clock.
 * @param opts.timeZone - The workspace's timezone for the date labels.
 */
export async function publishBriefingDocument(
  orgId: string,
  input: PublishBriefingInput,
  opts: { teamSlug: string | null; agentSlug?: string | null; userId?: string | null; now?: Date; timeZone?: string },
): Promise<{ id: number; doc: BriefingV2; dropped: BriefingIssue[]; replaced: boolean }> {
  const now = opts.now ?? new Date();
  const { dateLabel, updatedLabel } = briefingLabels(now, opts.timeZone ?? 'UTC');
  // The publisher dates the briefing; the model only names it (`title.ts`).
  // Done here, on the one path every publish takes, rather than in each tool.
  const title = briefingTitle(input.title, now);
  const publishedBy = opts.agentSlug ? `agent:${opts.agentSlug}` : (opts.userId ?? null);

  // A workspace brief composes from the teams' latest; a team brief composes
  // from its own reading only — a team briefing inside a team briefing is the
  // same defect one level down.
  const teamSources: TeamBriefingSource[] = [];
  if (opts.teamSlug === null) {
    const teams = await db.select({ slug: teamSchema.slug, name: teamSchema.name }).from(teamSchema).where(eq(teamSchema.orgId, orgId));
    for (const team of teams) {
      const latest = await latestBriefing(orgId, team.slug);
      if (latest?.document) {
        teamSources.push({ briefingId: latest.id, teamSlug: team.slug, teamName: team.name, at: latest.createdAt, doc: latest.document });
      }
    }
  }

  const [prior, history, decisions, vocab] = await Promise.all([
    priorBriefing(orgId, opts.teamSlug, now),
    briefingHistory(orgId, opts.teamSlug),
    decisionsSection(orgId, { whyNow: input.whyNow, incidents: input.incidents, now }),
    workspaceVocabulary(orgId),
  ]);

  const { doc, dropped } = composeWorkspaceBriefing({
    title,
    dateLabel,
    updatedLabel,
    teamSlug: opts.teamSlug,
    teams: teamSources,
    own: { metrics: input.metrics, criticalPath: input.criticalPath, exceptions: input.exceptions, detail: input.detail },
    prior: prior?.document ?? null,
    ...(input.summary ? { summary: input.summary } : {}),
    decisions,
    narratives: input.narratives,
    ...(input.agentActivity ? { agentActivity: input.agentActivity } : {}),
    ...(input.targetSet !== undefined ? { targetSet: input.targetSet } : {}),
    history: history.entries,
    historyTotal: history.total,
    vocab,
  });

  // The contract is checked on the way out, not asked for on the way in.
  assertBriefingV2(doc, vocab);

  const values = {
    title: doc.title.slice(0, 200),
    content: renderBriefingMarkdown(doc),
    document: doc,
    publishedBy,
    agentSlug: opts.agentSlug ?? null,
    teamSlug: opts.teamSlug,
  };

  // A second publish from the same publisher into the same scope minutes
  // after the first is the same briefing again — the agent retried after the
  // contract trimmed something, or called the tool twice — not a new edition.
  // It REPLACES the first row rather than sitting beside it, so the Briefings
  // page never shows two identical entries a minute apart (`republish.ts`).
  const latest = await latestBriefing(orgId, opts.teamSlug);
  if (latest && replacesPrior({ createdAt: latest.createdAt, publishedBy: latest.publishedBy }, publishedBy, now)) {
    await db.update(briefingSchema).set({ ...values, createdAt: now }).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, latest.id)));
    return { id: latest.id, doc, dropped, replaced: true };
  }

  const [row] = await db.insert(briefingSchema).values({ orgId, ...values, createdAt: now }).returning({ id: briefingSchema.id });

  return { id: row!.id, doc, dropped, replaced: false };
}
