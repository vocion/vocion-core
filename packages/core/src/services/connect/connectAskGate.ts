/**
 * ONE CONNECT ASK PER SYSTEM, AND ONLY AT THE STEP THAT NEEDS IT.
 *
 * 2026-10-29, the SEO app on prod: a person asked the strategist for a
 * keyword list and AI-answer prompts. Before doing anything it asked them to
 * connect GitHub. They skipped it, and it asked again — four asks in thirty
 * seconds, each skipped, with empty replies between them — until they typed
 * "don't worry about github" and connected it to make it stop. Nothing they
 * asked for needed GitHub: only publishing a page does.
 *
 * So whether a connect card goes up is decided here, in code, for every way
 * one is made (`offer_connection`, the card a failed tool raises, the
 * "Connect your systems" walk, a setup ask filed by hand):
 *
 *   - PUBLISH ONLY. A connector the agent's plugin names `publishOnly`
 *     (`plugin.yaml` `recommend.publishOnly`; SEO: GitHub, Squarespace) is
 *     asked for only when an action that `connects` it (`site.publish_page`)
 *     could not run for want of it, in this turn. Research, plans, briefs,
 *     drafts and reviews never ask.
 *   - NO REPEAT. A connect ask a person skipped or declined holds for seven
 *     days: in this conversation and for the same Project (the work's, now
 *     that connections belong to a Project), and at the publish step for
 *     the same Project. A skip before publishing does not hold back the publish step,
 *     which is the first time it was really needed. An ask still open is
 *     pointed to, never asked twice.
 *   - REQUESTED. A GitHub install a person asked an owner to approve is
 *     waiting on that owner: asking again does nothing, so the state is said.
 *
 * Refused, the caller hands the model the existing state and one instruction:
 * say in one line what it did instead.
 */

import type { AskObjectRef, AskOption } from '@/models/Schema';
import type { RuntimeContext } from '@/services/agents/types';

/** How long a skipped or declined connect ask holds. */
export const SKIP_HOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The ref a connect ask raised at a publish step carries beside its Project
 * (`data_room`), so a decline there is told from one made in a chat about
 * the same Project.
 */
export const PUBLISH_STEP_REF = { type: 'connect_step', id: 'publish' } as const;

/** The callback's reason code for a GitHub install sent to an owner for approval. */
export const INSTALL_REQUESTED = 'installation_requested';

/** A connect ask, as the gate reads it. */
export type ConnectAskRow = {
  id: number;
  status: string;
  decision: string | null;
  options: readonly Pick<AskOption, 'id' | 'href'>[];
  objectRefs: readonly AskObjectRef[] | null;
  conversationId: number | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type ConnectAskCheck = {
  connector: string;
  /** The connector's name, for the words. */
  name: string;
  /** The conversation the card would go up in. */
  conversationId: number | null;
  /** The Project: the one the publish step is for, else the one the work is scoped to. */
  projectId: number | null;
  /** An action that `connects` this connector could not run for want of it, this turn. */
  publishStep: boolean;
  /** The asking agent's plugin asks for it only at the publish step. */
  publishOnly: boolean;
  /** A GitHub install request still waiting on an owner, with its words. */
  requested: { at: Date; summary: string } | null;
  now: Date;
};

export type ConnectAskVerdict
  = | { ok: true }
    | { ok: false; reason: 'publish_only' | 'open' | 'declined' | 'requested'; askId?: number; reply: string };

/**
 * Whether a person turned a connect ask down: skipped it, rejected it, or
 * answered it in their own words without connecting ("don't worry about it").
 * @param row - The ask.
 * @param row.status - Its status.
 * @param row.decision - What was chosen.
 */
export function declined(row: Pick<ConnectAskRow, 'status' | 'decision'>): boolean {
  return row.status === 'skipped' || row.status === 'rejected' || row.decision === 'other' || row.decision === 'reject';
}

/**
 * The connectors a connect ask is for, from its options: `connect:<slug>`,
 * `paste:<slug>`, `install:<slug>`, `request:<slug>`, or a link naming `connector=` / `add=`.
 * Pure.
 * @param options - The ask's options.
 */
export function connectorsOfAsk(options: readonly Pick<AskOption, 'id' | 'href'>[]): string[] {
  const out = new Set<string>();
  for (const option of options) {
    const byId = /^(?:connect|paste|install|request):([a-z0-9][a-z0-9-]*)$/.exec(option.id);
    if (byId) {
      out.add(byId[1]!);
    }
    if (!option.href) {
      continue;
    }
    try {
      const url = new URL(option.href, 'http://in-app.invalid');
      const slug = url.searchParams.get('connector') ?? url.searchParams.get('add');
      if (slug && /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
        out.add(slug);
      }
    } catch {
      // Not a link.
    }
  }
  return [...out];
}

/**
 * "Oct 29".
 * @param at - When.
 */
function day(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(at);
}

/**
 * Whether a connect card may go up now. Pure: the asks of this connector in
 * this conversation (and, at the publish step, for this Project) in, the
 * verdict out.
 * @param rows - Recent setup asks for this connector, newest first.
 * @param check - What is being asked, where, and at which step.
 */
export function connectAskVerdict(rows: readonly ConnectAskRow[], check: ConnectAskCheck): ConnectAskVerdict {
  const { name } = check;
  if (check.publishOnly && !check.publishStep) {
    return {
      ok: false,
      reason: 'publish_only',
      reply: `Not asked: ${name} is only needed to publish, and the publish step asks for it itself when the project's site is on ${name}. Research, plans, briefs, drafts and reviews go ahead without it. Do not ask for it or wait on it; say in one line what you are doing instead. Only if the person asked to connect it themselves, point them to Team connectors: /dashboard/connectors?add=${encodeURIComponent(check.connector)}.`,
    };
  }
  if (check.requested && check.now.getTime() - check.requested.at.getTime() < SKIP_HOLD_MS) {
    return {
      ok: false,
      reason: 'requested',
      reply: `Not asked: ${check.requested.summary} (requested ${day(check.requested.at)}). Asking again changes nothing until an owner approves it; then a person connects ${name} again here to pick it up. Say so in one line and carry on with what does not need it.`,
    };
  }
  const since = check.now.getTime() - SKIP_HOLD_MS;
  const ofProject = (row: ConnectAskRow) => check.projectId !== null && (row.objectRefs ?? []).some(r => r.type === 'data_room' && String(r.id) === String(check.projectId));
  const atPublish = (row: ConnectAskRow) => (row.objectRefs ?? []).some(r => r.type === PUBLISH_STEP_REF.type && String(r.id) === PUBLISH_STEP_REF.id);
  const mine = rows.filter(row => connectorsOfAsk(row.options).includes(check.connector));
  const open = mine.find(row => row.status === 'open' && (row.conversationId === check.conversationId || ofProject(row)));
  if (open) {
    return { ok: false, reason: 'open', askId: open.id, reply: `Not asked again: ask #${open.id} to connect ${name} is already open${open.conversationId === check.conversationId ? ', docked above their composer' : ''}. Point to it in one line.` };
  }
  const held = mine.find((row) => {
    if (!declined(row) || (row.decidedAt ?? row.createdAt).getTime() < since) {
      return false;
    }
    // At the publish step, only a decline at a publish step of this Project holds.
    return check.publishStep ? ofProject(row) && atPublish(row) : row.conversationId === check.conversationId || ofProject(row);
  });
  if (held) {
    const how = held.status === 'skipped' ? 'skipped' : 'declined';
    return {
      ok: false,
      reason: 'declined',
      askId: held.id,
      reply: `Not asked: they ${how} connecting ${name} on ${day(held.decidedAt ?? held.createdAt)} (ask #${held.id}), so it is not asked again ${check.publishStep ? 'for this project' : 'here'} for seven days${check.publishStep ? '' : ' or until publishing needs it'}. Carry on without it and say in one line what you did instead.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The publish step, as this turn found it                              */
/* ------------------------------------------------------------------ */

/** The connectors an action that `connects` them found missing this turn, with the Project. */
const publishSteps = new WeakMap<object, Map<string, number | null>>();

/**
 * Mark that this turn's publish step needed the connector: an action that
 * `connects` it could not run for want of it.
 * @param ctx - The turn.
 * @param connector - The connector.
 * @param projectId - The Project the publish is for, when known.
 */
export function markPublishStep(ctx: object, connector: string, projectId: number | null): void {
  const steps = publishSteps.get(ctx) ?? new Map<string, number | null>();
  steps.set(connector, projectId);
  publishSteps.set(ctx, steps);
}

/**
 * The publish step this turn found for the connector, or null.
 * @param ctx - The turn.
 * @param connector - The connector.
 */
export function publishStepOf(ctx: object, connector: string): { projectId: number | null } | null {
  const steps = publishSteps.get(ctx);
  return steps?.has(connector) ? { projectId: steps.get(connector) ?? null } : null;
}

/**
 * The action a tool call proposes, and its input, when it is one
 * (`propose_action`, `recommend_action`).
 * @param toolName - The tool.
 * @param input - Its arguments.
 */
export function proposedAction(toolName: string, input: unknown): { actionId: string; input: Record<string, unknown> } | null {
  if (toolName !== 'propose_action' && toolName !== 'recommend_action') {
    return null;
  }
  const args = (input ?? {}) as { action_id?: unknown; action_input?: unknown };
  if (typeof args.action_id !== 'string') {
    return null;
  }
  return { actionId: args.action_id, input: args.action_input && typeof args.action_input === 'object' ? args.action_input as Record<string, unknown> : {} };
}

/**
 * Whether an action is the step that needs this connector (`connects`).
 * @param actionId - The action.
 * @param connector - The connector.
 */
export async function actionConnects(actionId: string, connector: string): Promise<boolean> {
  const { getAction } = await import('@/libs/actions/registry');
  return getAction(actionId)?.connects?.includes(connector) === true;
}

/**
 * The Project a publish action is for: its `projectId`, else its page
 * record's. Null when it cannot be read.
 * @param orgId - The workspace.
 * @param input - The action's input.
 */
export async function projectOfPublish(orgId: string, input: Record<string, unknown>): Promise<number | null> {
  const direct = Number(input.projectId);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }
  try {
    const { planPublish } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(orgId, input as never);
    return planned.ok ? planned.plan.project.id : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The gate, with what it reads                                          */
/* ------------------------------------------------------------------ */

/**
 * The connectors the asking agent's plugins ask for only at the publish step.
 * @param agentSlug - The agent.
 */
export async function publishOnlyFor(agentSlug: string | undefined): Promise<Set<string>> {
  if (!agentSlug) {
    return new Set();
  }
  const { listPlugins } = await import('@/libs/workspace/plugins');
  return new Set(listPlugins().filter(p => p.contents.agents.includes(agentSlug)).flatMap(p => p.manifest.recommend.publishOnly ?? []));
}

/**
 * Recent setup asks in this conversation, or about this Project.
 * @param orgId - The workspace.
 * @param where - The conversation and the Project.
 * @param where.conversationId - The conversation.
 * @param where.projectId - The Project.
 * @param now - Now.
 */
async function recentSetupAsks(orgId: string, where: { conversationId: number | null; projectId: number | null }, now: Date): Promise<ConnectAskRow[]> {
  if (where.conversationId === null && where.projectId === null) {
    return [];
  }
  const [{ db }, { askSchema }, { and, desc, eq, gt, or, sql }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const scope = [
    ...(where.conversationId !== null ? [eq(askSchema.conversationId, where.conversationId)] : []),
    ...(where.projectId !== null ? [sql`${askSchema.objectRefs} @> ${JSON.stringify([{ type: 'data_room', id: String(where.projectId) }])}::jsonb`] : []),
  ];
  return db
    .select({ id: askSchema.id, status: askSchema.status, decision: askSchema.decision, options: askSchema.options, objectRefs: askSchema.objectRefs, conversationId: askSchema.conversationId, createdAt: askSchema.createdAt, decidedAt: askSchema.decidedAt })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.kind, 'setup'), gt(askSchema.createdAt, new Date(now.getTime() - SKIP_HOLD_MS)), or(...scope)))
    .orderBy(desc(askSchema.id))
    .limit(50);
}

/**
 * A GitHub install request still waiting on an owner: the newest attempt for
 * the connector is one.
 * @param orgId - The workspace.
 * @param connector - The connector.
 */
async function pendingRequest(orgId: string, connector: string): Promise<{ at: Date; summary: string } | null> {
  const { lastConnectAttempts } = await import('@/libs/connect/attempts');
  const last = (await lastConnectAttempts(orgId)).get(connector);
  return last && !last.ok && last.reason === INSTALL_REQUESTED ? { at: last.at, summary: last.summary ?? 'Install requested: waiting for an owner of the organization to approve it' } : null;
}

/**
 * Whether this turn may put up a connect card for the connector. Never
 * throws: a check that cannot read lets the card through.
 * @param ctx - The turn.
 * @param connector - The connector.
 * @param name - Its name.
 */
export async function connectAskGate(ctx: Pick<RuntimeContext, 'orgId' | 'agentSlug' | 'conversationId' | 'workProjectId'>, connector: string, name: string): Promise<ConnectAskVerdict> {
  try {
    const step = publishStepOf(ctx, connector);
    const now = new Date();
    const [publishOnly, requested] = await Promise.all([publishOnlyFor(ctx.agentSlug), pendingRequest(ctx.orgId, connector).catch(() => null)]);
    const check: ConnectAskCheck = {
      connector,
      name,
      conversationId: ctx.conversationId ?? null,
      projectId: step?.projectId ?? ctx.workProjectId ?? null,
      publishStep: step !== null,
      publishOnly: publishOnly.has(connector),
      requested,
      now,
    };
    // Publish-only and requested need no rows.
    const first = connectAskVerdict([], check);
    if (!first.ok) {
      return first;
    }
    return connectAskVerdict(await recentSetupAsks(ctx.orgId, { conversationId: check.conversationId, projectId: check.projectId }, now), check);
  } catch (error) {
    console.warn('connectAskGate: could not check, letting the card through', { orgId: ctx.orgId, connector, message: (error as Error).message });
    return { ok: true };
  }
}

/**
 * The systems a setup ask filed by hand (`file_ask`) asks to connect: the
 * connectable systems its title names ("Connect GitHub"), or its options
 * name. Pure apart from the connector list.
 * @param title - The ask's question.
 * @param options - Its options, as the model wrote them.
 * @param connectors - The connectable systems, slug and name.
 */
export function connectorsInSetupAsk(title: string, options: ReadonlyArray<string | { id?: string; label: string }>, connectors: ReadonlyArray<{ slug: string; name: string }>): Array<{ slug: string; name: string }> {
  const text = [title, ...options.map(o => (typeof o === 'string' ? o : o.label))].join(' ').toLowerCase();
  if (!/\b(?:connect|install|sign in|log in|authori[sz]e|link)\b/.test(text)) {
    return [];
  }
  return connectors.filter(c => [c.name, c.slug].some(word => word.length >= 3 && new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)));
}
