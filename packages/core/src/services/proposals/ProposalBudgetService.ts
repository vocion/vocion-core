import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, agentSchema, askSchema } from '@/models/Schema';

/**
 * THE PROPOSAL BUDGET — no runaway queues.
 *
 * Chris, 2026-09-24: "700 items need attention is uselessly overwhelming."
 * An agent on its own schedule — a mission check every two hours, an
 * automation on every event — files proposals and asks as fast as it can
 * think of them, and every one lands in Review for a person. When the person
 * does not keep up, the queue grows without bound and stops being a queue.
 *
 * So: when an agent acts on its own schedule it may hold at most `openMax`
 * undecided items in Review (pending action runs and open asks it filed) and
 * file at most `weeklyMax` new candidate records (its ideas) in a rolling
 * week. Past either, filing is REFUSED — with the list of its own open items
 * and the instruction to withdraw one first — so a better idea retires an
 * older one instead of stacking on it. A proposal made inside a person's own
 * chat turn never counts: the person asked, and the person is right there.
 *
 * Core, at the agent level with a workspace default, never a plugin rule:
 * the budget lives on the agent row (`approvalPolicy.proposals`, written by
 * the applier from the agent's `proposals:` or `defaults.agentProposals`),
 * and the built-in default applies where nothing is set, so an agent nobody
 * configured is still bounded. Enforced in the tools an agent files with
 * (`propose_action`, `file_ask`), not in the services underneath: a person, a
 * token or the review router filing on purpose is not the runaway.
 */

export type ProposalBudget = { openMax: number; weeklyMax: number };

/** What an unconfigured agent gets. Bounded, and generous enough for a busy day. */
export const DEFAULT_PROPOSAL_BUDGET: ProposalBudget = { openMax: 5, weeklyMax: 10 };

/** The action whose runs count as "ideas" for the weekly cap: filing a new record. */
export const IDEA_ACTION_ID = 'objects.propose_candidate';

const WEEK_MS = 7 * 86_400_000;

/** A run's `userId` that means "no person in the loop" (`RuntimeContext.userId`). */
const NOBODY = new Set(['scheduled', 'system', 'automation', 'mission', '']);

/**
 * Is this turn a person's, or the agent's own schedule?
 *
 * A person in the conversation exempts the turn: they asked, they are there
 * to decide. A mission run, an automation, anything with no conversation or
 * a synthetic actor is the agent acting on its own.
 * @param ctx - What the runtime knows about the turn.
 * @param ctx.userId - Who triggered the run (a user id, 'mcp', 'scheduled', …).
 * @param ctx.conversationId - The conversation, when there is one.
 * @param ctx.missionRunId - The mission run, when this is one.
 */
export function isAgentsOwnSchedule(ctx: { userId?: string | null; conversationId?: number | null; missionRunId?: number | null }): boolean {
  if (ctx.missionRunId) {
    return true;
  }
  if (!ctx.conversationId) {
    return true;
  }
  return !ctx.userId || NOBODY.has(ctx.userId);
}

/**
 * The budget in force for one agent: its row's, else the built-in.
 * @param orgId - The project.
 * @param agentSlug - The agent.
 */
export async function proposalBudgetFor(orgId: string, agentSlug: string): Promise<ProposalBudget> {
  const [row] = await db
    .select({ approvalPolicy: agentSchema.approvalPolicy })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)))
    .limit(1);
  const raw = (row?.approvalPolicy as { proposals?: { openMax?: unknown; weeklyMax?: unknown } } | null)?.proposals;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);
  return {
    openMax: num(raw?.openMax, DEFAULT_PROPOSAL_BUDGET.openMax),
    weeklyMax: num(raw?.weeklyMax, DEFAULT_PROPOSAL_BUDGET.weeklyMax),
  };
}

export type OpenProposal = { kind: 'run' | 'ask'; id: number; title: string; createdAt: Date };

/**
 * What this agent is holding in front of a person right now: its pending
 * action runs and its open asks, oldest first.
 * @param orgId - The project.
 * @param agentSlug - The agent.
 */
export async function openProposals(orgId: string, agentSlug: string): Promise<OpenProposal[]> {
  const invokedBy = `agent:${agentSlug}`;
  const [runs, asks] = await Promise.all([
    db
      .select({ id: actionRunSchema.id, input: actionRunSchema.input, actionId: actionRunSchema.actionId, createdAt: actionRunSchema.createdAt })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.invokedBy, invokedBy), eq(actionRunSchema.status, 'pending'))),
    db
      .select({ id: askSchema.id, title: askSchema.title, createdAt: askSchema.createdAt })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.agentSlug, agentSlug), eq(askSchema.status, 'open'))),
  ]);
  const out: OpenProposal[] = [
    ...runs.map(r => ({ kind: 'run' as const, id: r.id, title: String((r.input as { title?: unknown }).title ?? r.actionId), createdAt: r.createdAt })),
    ...asks.map(a => ({ kind: 'ask' as const, id: a.id, title: a.title, createdAt: a.createdAt })),
  ];
  out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return out;
}

/**
 * How many new records this agent proposed in the last seven days, whatever
 * happened to them — the weekly idea count.
 * @param orgId - The project.
 * @param agentSlug - The agent.
 * @param now - The clock.
 */
export async function weeklyIdeaCount(orgId: string, agentSlug: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.invokedBy, `agent:${agentSlug}`),
      eq(actionRunSchema.actionId, IDEA_ACTION_ID),
      gte(actionRunSchema.createdAt, new Date(now.getTime() - WEEK_MS)),
    ));
  return row?.n ?? 0;
}

export type BudgetVerdict
  = | { ok: true; open: number; openMax: number }
    | { ok: false; reason: 'open' | 'weekly'; message: string; open: OpenProposal[]; budget: ProposalBudget; weekly: number };

/**
 * May this agent file one more thing right now?
 *
 * The message, when not, is written for the model that is about to be told
 * no: what the cap is, what it is holding, and the one move that frees a
 * slot — withdraw one of its own, naming what supersedes it.
 * @param opts - The agent, and whether this is an idea (counts against the week) or any proposal.
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.actionId - The action being proposed; `objects.propose_candidate` is an idea.
 * @param opts.now
 */
export async function checkProposalBudget(opts: { orgId: string; agentSlug: string; actionId?: string; now?: Date }): Promise<BudgetVerdict> {
  const budget = await proposalBudgetFor(opts.orgId, opts.agentSlug);
  const open = await openProposals(opts.orgId, opts.agentSlug);
  if (open.length >= budget.openMax) {
    const list = open.slice(0, 8).map(o => `${o.kind === 'run' ? 'proposal' : 'ask'} #${o.id} — ${o.title} (${o.createdAt.toISOString().slice(0, 10)})`).join('\n');
    return {
      ok: false,
      reason: 'open',
      open,
      budget,
      weekly: 0,
      message: `Refused: you already have ${open.length} undecided item${open.length === 1 ? '' : 's'} in Review and your limit while acting on your own schedule is ${budget.openMax}. A person has not caught up; adding more does not help them. Withdraw one of yours first with withdraw_proposal (name what supersedes it), or wait for a decision. Yours, oldest first:\n${list}`,
    };
  }
  if (opts.actionId === IDEA_ACTION_ID) {
    const weekly = await weeklyIdeaCount(opts.orgId, opts.agentSlug, opts.now);
    if (weekly >= budget.weeklyMax) {
      return {
        ok: false,
        reason: 'weekly',
        open,
        budget,
        weekly,
        message: `Refused: you have proposed ${weekly} new records in the last seven days and your limit is ${budget.weeklyMax}. New ideas wait until the week rolls; a person's own request never counts against this, so if someone asked, say who.`,
      };
    }
  }
  return { ok: true, open: open.length, openMax: budget.openMax };
}

/**
 * The agent takes back one of its own undecided items — a pending action run
 * or an open ask — because a better idea supersedes it or the thing it asked
 * about went away. Refuses anything it did not file: an agent never decides
 * another agent's, or a person's, proposals.
 * @param opts - Which item, why, and what replaced it.
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.kind
 * @param opts.id
 * @param opts.reason
 * @param opts.supersededBy - The id of the run or ask that replaces it, when one does.
 */
export async function withdrawProposal(opts: { orgId: string; agentSlug: string; kind: 'run' | 'ask'; id: number; reason: string; supersededBy?: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const note = `Withdrawn by ${opts.agentSlug}: ${opts.reason.trim()}${opts.supersededBy ? ` — superseded by ${opts.supersededBy}` : ''}`;
  if (opts.kind === 'run') {
    const [row] = await db
      .select({ id: actionRunSchema.id, invokedBy: actionRunSchema.invokedBy, status: actionRunSchema.status })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, opts.orgId), eq(actionRunSchema.id, opts.id)))
      .limit(1);
    if (!row) {
      return { ok: false, message: `No proposal #${opts.id}.` };
    }
    if (row.invokedBy !== `agent:${opts.agentSlug}`) {
      return { ok: false, message: `Proposal #${opts.id} is not yours to withdraw.` };
    }
    if (row.status !== 'pending') {
      return { ok: false, message: `Proposal #${opts.id} is already ${row.status}.` };
    }
    const { rejectAction } = await import('@/services/ActionService');
    await rejectAction(opts.id, opts.orgId, note, { reviewedBy: `agent:${opts.agentSlug}` });
    return { ok: true };
  }
  const { getAsk, supersedeAsk } = await import('@/services/AskService');
  const ask = await getAsk(opts.orgId, opts.id);
  if (!ask) {
    return { ok: false, message: `No ask #${opts.id}.` };
  }
  if (ask.agentSlug !== opts.agentSlug) {
    return { ok: false, message: `Ask #${opts.id} is not yours to withdraw.` };
  }
  if (ask.status !== 'open') {
    return { ok: false, message: `Ask #${opts.id} is already ${ask.status}.` };
  }
  await supersedeAsk(opts.orgId, opts.id, note);
  return { ok: true };
}

/**
 * One line for a Review header or an agent's receipt: `open 3/5 · ideas 4/10 this week`.
 * @param orgId
 * @param agentSlug
 */
export async function proposalBudgetLine(orgId: string, agentSlug: string): Promise<string> {
  const [budget, open, weekly] = await Promise.all([proposalBudgetFor(orgId, agentSlug), openProposals(orgId, agentSlug), weeklyIdeaCount(orgId, agentSlug)]);
  return `open ${open.length}/${budget.openMax} · ideas ${weekly}/${budget.weeklyMax} this week`;
}
