/**
 * The daily usage review — did each chat get the person where they wanted?
 *
 * Once a day, in each workspace's own time zone, the Workspace manager's
 * mission (`templates/plugins/workspace-manager`) asks this service to read
 * the day: every chat thread a person wrote in and every proposal or ask a
 * person decided. Code computes the facts (`facts.ts`); for an Org that lets
 * the review read content (`privacy.ts`), a small model judges each thread
 * (`judge.ts`) within a daily spend cap, most friction first. The day is
 * written up as a briefing on the workspace's Briefings (`report.ts`), and the
 * fixes the evidence supports — a connector or skill people needed, a standing
 * rule that would have prevented the friction — are filed as `org.change`
 * proposals on Needs you, through the org review's own path. Nothing is
 * stamped on a thread or a decision: the report is the artifact.
 *
 * A workspace nobody used that day is skipped before anything is read.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ReviewDecision } from './facts';
import type { JudgeItem, ThreadJudgement, WorkspaceContext } from './judge';
import type { ReadModeDecision } from './privacy';
import type { ReviewApproval, ReviewThread, UsageWindow } from './reader';
import type { FiledFix, ItemResult, UsageReport } from './report';
import type { OrgChange, OrgEvidenceItem } from '@/libs/actions/org-change';
import { and, eq } from 'drizzle-orm';
import { ORG_CHANGE_LABEL } from '@/libs/actions/org-change';
import { db } from '@/libs/DB';
import { PERSONAL_CONNECTIONS } from '@/libs/personal/connections';
import { agentSchema, knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { inboxHref } from '@/services/inbox/inboxRef';
import { describeFacts, frictionScore, structuralOutcome, structuralThemes, threadFacts } from './facts';
import { judgeItem } from './judge';
import { readModeForAccount } from './privacy';
import { hadActivity, readApprovals, readThreads } from './reader';
import { briefingInput, summarize, TABLE } from './report';

/**
 * The seat the review's briefings and proposals are filed under: the
 * Workspace manager, whose plugin runs it. Its own ledger, never another
 * agent's, so the *agrees with you* score on its proposals is its own.
 */
export const USAGE_REVIEW_SEAT = 'workspace-manager';

/** The day the review reads. */
const DAY_MS = 86_400_000;

/** What one workspace's review may spend on the judge in a day, when the deployment says nothing. */
export const DEFAULT_DAILY_CENTS = 50;

/** Never more than this many items judged in one day, whatever the cap allows. */
const MAX_JUDGED = 60;

/** Fixes one review may file. The strongest few; the rest wait for tomorrow's evidence. */
const MAX_FIXES = 3;

export type UsageReviewResult = {
  orgId: string;
  asOf: string;
  skipped?: 'no_project' | 'personal_workspace' | 'workspace_paused' | 'no_activity';
  report?: UsageReport;
  briefingId?: number | null;
};

type Model = Pick<BaseChatModel, 'bindTools'>;

/**
 * The judge's daily spend cap for one workspace, in cents.
 * @param raw - `VOCION_USAGE_REVIEW_DAILY_CENTS`.
 */
export function dailyCapCents(raw: string | undefined = process.env.VOCION_USAGE_REVIEW_DAILY_CENTS): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CENTS;
}

/**
 * The order items are judged in when not all of them can be: the most
 * friction first, then a spread of the rest so a quiet thread that went badly
 * in a way the numbers miss still has a chance. Pure.
 * @param items - The judgeable items with their friction.
 */
export function judgingOrder<T extends { ref: string; friction: number }>(items: readonly T[]): T[] {
  const friction = items.filter(i => i.friction > 0).sort((a, b) => b.friction - a.friction || a.ref.localeCompare(b.ref));
  const quiet = items.filter(i => i.friction === 0);
  // Every other quiet item, then the ones between: a spread, not the oldest few.
  const spread = [...quiet.filter((_, i) => i % 2 === 0), ...quiet.filter((_, i) => i % 2 === 1)];
  return [...friction, ...spread];
}

/**
 * Run one workspace's daily usage review.
 * @param orgId - The workspace.
 * @param opts - The clock, a model for tests, and whether to publish and file.
 * @param opts.now - The end of the day read.
 * @param opts.model - Injected judge model (tests); the org's classifier otherwise.
 * @param opts.publish - Publish the briefing (default true).
 * @param opts.file - File the fixes as proposals (default true).
 * @param opts.capCents - The judge's cap for this run; the deployment's otherwise.
 */
export async function runUsageReview(orgId: string, opts: { now?: Date; model?: Model; publish?: boolean; file?: boolean; capCents?: number } = {}): Promise<UsageReviewResult> {
  const now = opts.now ?? new Date();
  const base: UsageReviewResult = { orgId, asOf: now.toISOString() };
  const [project] = await db
    .select({ name: projectSchema.name, kind: projectSchema.kind, accountId: projectSchema.accountId, timeZone: projectSchema.timeZone })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return { ...base, skipped: 'no_project' };
  }
  // One person's assistant is not a team using a platform; their threads are theirs.
  if (project.kind === 'personal') {
    return { ...base, skipped: 'personal_workspace' };
  }
  const { readWorkspacePause } = await import('@/services/workspacePause');
  if (await readWorkspacePause(orgId)) {
    return { ...base, skipped: 'workspace_paused' };
  }
  const window: UsageWindow = { since: new Date(now.getTime() - DAY_MS), until: now };
  if (!await hadActivity(orgId, window)) {
    return { ...base, skipped: 'no_activity' };
  }

  const mode = await readModeForAccount(project.accountId);
  const [{ threads, total }, approvals, workspace] = await Promise.all([
    readThreads(orgId, window),
    readApprovals(orgId, window),
    workspaceContext(orgId, project.name),
  ]);
  const agentName = new Map(workspace.agents.map(a => [a.slug, a.name]));
  const { items, judgeable } = buildItems({ threads, approvals, mode, agentName });

  // The judge, in content mode only, most friction first, under the cap.
  let judgeCents = 0;
  let judgeNote: string | null = null;
  if (mode.mode === 'content' && judgeable.length > 0) {
    const cap = opts.capCents ?? dailyCapCents();
    let judged = 0;
    let lastCost = 0;
    const order = judgingOrder(judgeable);
    for (const j of order) {
      if (judged >= MAX_JUDGED || judgeCents + lastCost > cap) {
        judgeNote = `the ${judged} with the most friction first, then a spread; the rest read from structure (${judged >= MAX_JUDGED ? `at most ${MAX_JUDGED} a day` : `the day's $${(cap / 100).toFixed(2)} cap`})`;
        break;
      }
      const call = await judgeItem({ orgId, workspace, item: j.input }, opts.model);
      const cents = call.microCents / 1_000_000;
      judgeCents += cents;
      lastCost = cents;
      judged += 1;
      if (call.judgement) {
        applyJudgement(j.item, call.judgement);
      }
    }
  }

  const report = summarize({ orgId, workspaceName: project.name, window, mode, items, activeThreads: total, judgeCents, judgeNote });
  if (total > threads.length && !report.judgeNote) {
    report.judgeNote = `${total} threads were active; the first ${threads.length} were read`;
  }
  const byRef = new Map(items.map(i => [i.ref, i]));

  if (opts.file !== false) {
    report.fixes = await fileFixes(orgId, report, byRef, now);
  }

  let briefingId: number | null = null;
  if (opts.publish !== false) {
    const input = briefingInput(report, byRef);
    if (report.fixes.length > 0) {
      input.detail.splice(Math.max(0, input.detail.length - 1), 0, {
        title: TABLE.fixes,
        columns: ['Fix', 'Kind', 'Filed'],
        rows: report.fixes.map(f => [f.headline, ORG_CHANGE_LABEL[f.kind as keyof typeof ORG_CHANGE_LABEL] ?? f.kind, f.runId ? `[On Needs you](${inboxHref('proposal', f.runId)})` : (f.why ?? 'not filed')]),
      });
    }
    const { publishBriefingDocument } = await import('@/services/briefings/store');
    const published = await publishBriefingDocument(orgId, input, { teamSlug: USAGE_REVIEW_SEAT, agentSlug: USAGE_REVIEW_SEAT, now, timeZone: project.timeZone ?? 'UTC' });
    briefingId = published.id;
  }
  return { ...base, report, briefingId };
}

/** One judgeable item and the input the judge reads for it. */
type Judgeable = { ref: string; friction: number; item: ItemResult; input: JudgeItem };

/**
 * Every item's facts and structural reading, and the ones the judge may read.
 * In metadata mode nothing is judgeable, and no item's label carries a word a
 * person wrote. Pure.
 * @param input - What was read.
 * @param input.threads - The day's threads.
 * @param input.approvals - The day's decisions.
 * @param input.mode - How the Org is read.
 * @param input.agentName - Agent names by slug.
 */
export function buildItems(input: { threads: readonly ReviewThread[]; approvals: readonly ReviewApproval[]; mode: ReadModeDecision; agentName: ReadonlyMap<string, string> }): { items: ItemResult[]; judgeable: Judgeable[] } {
  const content = input.mode.mode === 'content';
  const threadIds = new Set(input.threads.map(t => t.id));
  // A decision on an ask raised in a thread read today is part of that thread.
  const inThread = new Map<number, ReviewDecision[]>();
  const standalone: ReviewApproval[] = [];
  for (const a of input.approvals) {
    if (a.conversationId !== null && threadIds.has(a.conversationId)) {
      inThread.set(a.conversationId, [...(inThread.get(a.conversationId) ?? []), a]);
    } else {
      standalone.push(a);
    }
  }

  // A thread that read a person's OWN connection (their mail, calendar, files,
  // DMs) carries that person's data: it is read as metadata, never judged,
  // whatever the Org's setting (docs/security/google-api-data-handling.md).
  const ownData = new Set(PERSONAL_CONNECTIONS.flatMap(c => c.tools));
  const items: ItemResult[] = [];
  const judgeable: Judgeable[] = [];
  for (const t of input.threads) {
    const facts = threadFacts({ messages: t.messages, calls: t.calls, tools: t.tools, decisions: inThread.get(t.id) ?? [] });
    const name = input.agentName.get(t.agentSlug) ?? t.agentSlug;
    const readContent = content && !t.scoped && !t.tools.some(x => ownData.has(x.tool));
    const item: ItemResult = {
      ref: `thread:${t.id}`,
      kind: 'thread',
      href: `/dashboard/chat?conversation=${t.id}`,
      label: readContent ? clip(t.title, 60) : `Thread ${t.id} with ${name}`,
      agentSlug: t.agentSlug,
      agentName: name,
      facts,
      outcome: structuralOutcome(facts),
      outcomeBy: 'structure',
      themes: structuralThemes(facts),
      judgement: null,
      friction: frictionScore(facts),
    };
    items.push(item);
    if (readContent) {
      judgeable.push({ ref: item.ref, friction: item.friction, item, input: { ref: item.ref, kind: 'thread', agentSlug: t.agentSlug, facts: describeFacts(facts), messages: t.messages } });
    }
  }
  for (const a of standalone) {
    const waited = a.proposedAt ? Math.max(0, Math.round((a.decidedAt.getTime() - a.proposedAt.getTime()) / 60_000)) : null;
    const name = a.agentSlug ? input.agentName.get(a.agentSlug) ?? a.agentSlug : null;
    const overruled = a.agreed === false;
    const item: ItemResult = {
      ref: `${a.subjectKind}:${a.subjectId}`,
      kind: 'approval',
      href: inboxHref(a.subjectKind === 'ask' ? 'ask' : 'proposal', a.subjectId),
      label: content ? clip(a.title, 60) : `${a.subjectKind === 'ask' ? 'Ask' : 'Proposal'} ${a.subjectId}${name ? ` from ${name}` : ''}`,
      agentSlug: a.agentSlug,
      agentName: name,
      facts: null,
      approval: { decision: a.decision, recommended: a.recommended, agreed: a.agreed, waitedMinutes: waited, key: a.subjectKey },
      // A decision's outcome is whether the person took what was offered.
      outcome: a.decision === 'rejected' ? 'not_reached' : a.decision === 'edited' ? 'partial' : 'reached',
      outcomeBy: 'structure',
      themes: overruled ? ['approval_overruled'] : [],
      judgement: null,
      friction: (overruled ? 2 : 0) + (a.decision === 'rejected' ? 2 : a.decision === 'edited' ? 1 : 0),
    };
    items.push(item);
    if (content) {
      const facts = [
        `${a.subjectKind} ${a.subjectKey} → ${a.decision}${a.recommended ? ` (recommended ${a.recommended}${overruled ? ', overruled' : ''})` : ''}`,
        `waited ${waited === null ? 'unknown' : `${waited} min`} for a person; note left: ${a.hasNote ? 'yes' : 'no'}`,
      ].join('\n');
      judgeable.push({ ref: item.ref, friction: item.friction, item, input: { ref: item.ref, kind: 'approval', agentSlug: a.agentSlug, facts, approval: { title: a.title, reason: a.reason, decision: a.decision, recommended: a.recommended } } });
    }
  }
  return { items, judgeable };
}

/**
 * Fold a judgement into its item: the judge's outcome and themes join the
 * structural ones; the counts stay code's.
 * @param item - The item.
 * @param j - Its judgement.
 */
export function applyJudgement(item: ItemResult, j: ThreadJudgement): void {
  item.judgement = j;
  item.outcome = j.outcome;
  item.outcomeBy = 'judge';
  const themes = new Set([...item.themes, ...j.themes]);
  for (const m of j.missing) {
    themes.add(m.kind === 'connector' ? 'missing_connector' : m.kind === 'skill' ? 'missing_skill' : 'missing_tool');
  }
  if (j.effort_fit !== 'right') {
    themes.add('wrong_effort');
  }
  item.themes = [...themes];
  item.friction += themes.size > 0 && j.outcome !== 'reached' ? 1 : 0;
}

/**
 * The fixes the evidence supports, strongest first. Code chooses which: a
 * capability people needed in the most threads, then the standing rule from
 * the thread with the most friction. The judge wrote the words; the evidence
 * is the threads, each a link. Pure.
 * @param report - The day's summary.
 * @param items - The items, by ref.
 */
export function proposedFixes(report: UsageReport, items: ReadonlyMap<string, ItemResult>): Array<{ change: OrgChange; headline: string; reason: string; evidence: OrgEvidenceItem[]; confidence: number }> {
  if (report.mode.mode !== 'content') {
    return [];
  }
  const evidenceFor = (refs: readonly string[]): OrgEvidenceItem[] => refs.slice(0, 8).flatMap((ref) => {
    const i = items.get(ref);
    if (!i) {
      return [];
    }
    const better = i.judgement?.better;
    return [{ label: i.kind === 'thread' ? 'Thread' : 'Decision', value: clip(`${i.label}${better ? ` — ${better}` : ''}`, 400), href: i.href }];
  });
  const out: ReturnType<typeof proposedFixes> = [];
  for (const m of report.missing) {
    const noun = m.kind === 'connector' ? 'Connect' : 'Add';
    out.push({
      change: { kind: 'request_capability', capability: m.kind, name: m.name, need: clip(m.why, 400) },
      headline: clip(`${noun} ${m.name} — needed in ${m.refs.length} ${m.refs.length === 1 ? 'thread' : 'threads'} yesterday`, 200),
      reason: clip(`People asked for work that needed ${m.name} and the agents did not have it: ${m.why}`, 1_000),
      evidence: evidenceFor(m.refs),
      confidence: Math.min(0.9, 0.5 + 0.1 * m.refs.length),
    });
  }
  const ruled = [...items.values()]
    .filter(i => i.judgement?.rule && i.outcome !== 'reached')
    .sort((a, b) => b.friction - a.friction);
  for (const i of ruled) {
    const rule = i.judgement!.rule!.trim();
    if (rule.length < 8) {
      continue;
    }
    out.push({
      change: { kind: 'adopt_rule', ...(i.agentSlug ? { agentSlug: i.agentSlug } : {}), ruleText: clip(rule, 600) },
      headline: clip(`Adopt a rule: ${rule}`, 200),
      reason: clip(`${i.judgement!.better} The thread: ${i.judgement!.outcome_reason}`, 1_000),
      evidence: evidenceFor([i.ref]),
      confidence: 0.6,
    });
  }
  return out.slice(0, MAX_FIXES);
}

/**
 * File the day's fixes as `org.change` proposals, the org review's own path:
 * a person decides each one on Needs you, and a declined one is not asked
 * again for 30 days (the action's dedup).
 * @param orgId - The workspace.
 * @param report - The day's summary.
 * @param items - The items, by ref.
 * @param now - The clock.
 */
async function fileFixes(orgId: string, report: UsageReport, items: ReadonlyMap<string, ItemResult>, now: Date): Promise<FiledFix[]> {
  const fixes = proposedFixes(report, items);
  if (fixes.length === 0) {
    return [];
  }
  const { ActionError, proposeAction } = await import('@/services/ActionService');
  const out: FiledFix[] = [];
  for (const fix of fixes) {
    try {
      const res = await proposeAction({
        orgId,
        actionId: 'org.change',
        input: { change: fix.change, headline: fix.headline, reason: fix.reason, signal: 'usage', evidence: fix.evidence, asOf: now.toISOString() } as unknown as Record<string, unknown>,
        principal: { kind: 'agent', id: `agent:${USAGE_REVIEW_SEAT}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${USAGE_REVIEW_SEAT}`,
        // Core's own step: the evidence is the review's, kept on the input.
        internal: true,
        proposal: { confidence: fix.confidence, rationale: fix.reason, agentSlug: USAGE_REVIEW_SEAT, suggestedDecision: 'approve', suggestedDecisionReason: fix.headline },
      });
      if (res.outcome === 'already_decided') {
        out.push({ headline: fix.headline, kind: fix.change.kind, runId: null, why: 'a person already decided this; not asked again for 30 days' });
        continue;
      }
      out.push({ headline: fix.headline, kind: fix.change.kind, runId: res.runId });
    } catch (error) {
      const why = error instanceof ActionError ? error.message : 'could not be filed';
      if (!(error instanceof ActionError)) {
        console.error(`[usageReview] filing a fix in ${orgId} failed`, error);
      }
      out.push({ headline: fix.headline, kind: fix.change.kind, runId: null, why });
    }
  }
  return out;
}

/**
 * What the judge is told about the workspace: what it has connected and who works in it.
 * @param orgId - The workspace.
 * @param name - Its name.
 */
async function workspaceContext(orgId: string, name: string): Promise<WorkspaceContext> {
  const [sources, agents] = await Promise.all([
    db.select({ slug: knowledgeSourceSchema.slug }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId)),
    db.select({ slug: agentSchema.slug, name: agentSchema.name, description: agentSchema.description }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.active, 'true'))),
  ]);
  return { name, connectors: [...new Set(sources.map(s => s.slug))], agents };
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * One line a log or the mission reads about a review.
 * @param r - The result.
 */
export function usageReviewLine(r: UsageReviewResult): string {
  if (r.skipped) {
    return `usage review ${r.orgId}: skipped (${r.skipped})`;
  }
  const rep = r.report!;
  return `usage review ${r.orgId}: ${rep.threads.read} thread(s), ${rep.approvals} approval(s), read as ${rep.mode.mode}; ${rep.threads.judged} judged; outcome ${rep.outcome.rate ?? '—'}%, re-asked ${rep.reasks.rate ?? '—'}%; ${rep.fixes.filter(f => f.runId).length} fix(es) filed`;
}
