/**
 * One turn with the workspace, from a caller that is not a browser.
 *
 * The web chat streams (`app/[locale]/rpc/agent/stream/route.ts`); Slack and
 * mail answer in their own threads (`ChatSurfaceService`, `EmailSurfaceService`).
 * An MCP client had neither: it could work *as* an agent through the bridged
 * tools, but could not ask the workspace a question and get an answer. This
 * is that verb — `ask_workspace` over MCP — and it is deliberately the
 * workspace, not a named agent: the caller says what it wants, the router
 * picks who answers (`services/agents/router.ts`), and the decision comes
 * back with the reply so the caller can see why. A slug may still be named
 * to skip the router, the way an `@mention` does in chat.
 *
 * The turn itself is `runAgentDeep` — the same harness, tools, trust gating,
 * plugin gating and wiki mount the dashboard turn gets, because all of that
 * lives inside the harness rather than in the route that calls it — and it is
 * always persisted as a conversation: a caller with no screen has nothing
 * else to read back from, and a person can open it in the dashboard.
 *
 * Time. The web route has no turn limit; a tool call cannot wait forever.
 * A turn here is raced against {@link turnTimeLimitMs}; past it, the text
 * so far is returned with `truncated: true` and persisted, the turn keeps
 * running (the harness has no abort signal), and whatever it says after the
 * cut is appended to the same conversation when it finishes.
 */

import type { RoutingDecision } from '@/services/agents/router';
import type { AgentEvent } from '@/services/agents/types';
import type { CollectedDoc } from '@/services/chat/runCollector';
import process from 'node:process';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { appBaseUrl, workspaceUrl } from '@/libs/links';
import { readModelPrefs } from '@/libs/llm/modelPrefs';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { actionRunSchema, conversationSchema } from '@/models/Schema';
import { readInitiative } from '@/services/agents/initiative';
import { chooseAgent, routableFromRow } from '@/services/agents/router';
import { listAgents, runAgentDeep } from '@/services/AgentService';
import { askUrlFor } from '@/services/AskService';
import { preflightCheck } from '@/services/BudgetService';
import { autoProposeRecommendation, readAutonomy } from '@/services/chat/autoPropose';
import { RunCollector } from '@/services/chat/runCollector';
import { appendMessage, createConversation, getConversation, listMessages, toHistoryTurns } from '@/services/ConversationService';
import { projectSlugById } from '@/services/ProjectService';
import { allowedSourceSlugsForUser } from '@/services/SourceAccessService';
import { getWorkspaceLead } from '@/services/TeamService';
import { stoppedShort } from './turnStatus';

/** The most a caller may say in one turn. */
export const MAX_MESSAGE_CHARS = 20_000;

const DEFAULT_TURN_TIME_LIMIT_MS = 120_000;

/**
 * How long a caller waits on a turn before it gets what has streamed so far.
 * `VOCION_CHAT_TURN_LIMIT_MS` overrides the 120s default; read at call time.
 */
export function turnTimeLimitMs(): number {
  const raw = Number.parseInt(process.env.VOCION_CHAT_TURN_LIMIT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TURN_TIME_LIMIT_MS;
}

/** A refusal with a code a client can branch on. */
export class WorkspaceTurnError extends Error {
  code: string;
  details: Record<string, unknown> | null;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkspaceTurnError';
    this.code = code;
    this.details = details ?? null;
  }
}

/** One agent as the roster lists it — what a caller needs to address one, or to read a routing decision. */
export type AgentRosterEntry = {
  slug: string;
  name: string;
  eyebrow: string | null;
  description: string | null;
  active: boolean;
  role: string | null;
  teamSlug: string | null;
  handles: string[];
  initiative: 'low' | 'normal' | 'high';
  suggestions: Array<{ label: string; prompt: string }>;
  /** True for the workspace lead — the router's default. */
  lead: boolean;
};

/**
 * Every agent in the workspace, with the fields the router reads and a
 * caller chooses by.
 * @param orgId - Tenant.
 */
export async function listAgentRoster(orgId: string): Promise<AgentRosterEntry[]> {
  const [rows, lead] = await Promise.all([listAgents(orgId), getWorkspaceLead(orgId)]);
  return rows.map(row => ({
    slug: row.slug,
    name: row.name,
    eyebrow: row.eyebrow ?? null,
    description: row.description ?? null,
    active: row.active === 'true',
    role: row.role ?? null,
    teamSlug: row.teamSlug ?? null,
    handles: row.handles ?? [],
    initiative: readInitiative(row.initiative),
    suggestions: row.suggestions ?? [],
    lead: row.slug === lead.leadAgentSlug,
  }));
}

/** What an agent filed during the turn, with where a person decides it. */
export type TurnAction = {
  /** The `action_run` id. */
  id: number;
  /** Registered action id — `hubspot.update`, `ask.file`, `wiki.write_page`. */
  actionId: string;
  /** The run's status once the turn ended: pending, done, rejected… */
  status: string;
  /** Which tool filed it: `propose_action`, `file_ask`, `withdraw_ask`, or `recommend_action` (filed by the conversation's autonomy). */
  tool: string;
  /** How the filing went — `created`, `refreshed`, `already_decided` — when the tool said. */
  outcome: string | null;
  /** The ask this run filed, when it was `ask.file` and it ran. */
  askId: number | null;
  /** The review-queue (or ask) page for this item, workspace-aware. */
  url: string | null;
};

export type AskWorkspaceInput = {
  orgId: string;
  message: string;
  /** Who is asking, as the audit trail names them: `token:<id>` over HTTP, `mcp` on stdio. */
  actorId: string;
  /** Skip the router and talk to this agent. Absent, the router chooses. */
  agentSlug?: string;
  /** Continue this conversation — its agent answers, no routing. Absent, a new one is opened. */
  conversationId?: number;
  /** Title for a new conversation; absent, the first message names it. */
  title?: string;
  /** Test seam; production reads {@link turnTimeLimitMs}. */
  timeLimitMs?: number;
};

export type AskWorkspaceResult = {
  /** The agent's whole reply — or what it had said by the time limit. */
  reply: string;
  /** True when the time limit cut the reply; the rest lands in the conversation when the turn ends. */
  truncated: boolean;
  /** Who answered. */
  agentSlug: string;
  agentName: string;
  /** How the agent was chosen. Null when the caller named one or continued a conversation. */
  routing: RoutingDecision | null;
  conversationId: number;
  /** The assistant message row this turn wrote. */
  turnId: number;
  /** The observability trace for the turn; null when it was cut off before one was reported. */
  traceId: string | null;
  actions: TurnAction[];
  /** The conversation in the dashboard, workspace-aware. */
  url: string;
};

/** Dependency seam so the turn is testable without a model. */
export type WorkspaceTurnDeps = {
  runAgent: typeof runAgentDeep;
  preflight: typeof preflightCheck;
};

const defaultDeps: WorkspaceTurnDeps = { runAgent: runAgentDeep, preflight: preflightCheck };

/** The tools whose `tool_progress` carries a review-queue run id. */
const FILING_TOOLS = new Set(['propose_action', 'file_ask', 'withdraw_ask']);

type ToolProgress = { type: 'tool_progress'; tool: string; meta?: { runId?: unknown; status?: unknown; outcome?: unknown } };
type FiledRun = { runId: number; tool: string; outcome: string | null };

/**
 * A note under the message telling the model how it is being reached. The
 * mail surface does the same: an agent that knows there is no screen beside
 * its reply writes the whole answer into the reply and does not point at a
 * pane the caller cannot see.
 * @param actorId - Who is asking.
 */
function surfaceNote(actorId: string): string {
  return `\n\n--- how I am reaching you ---\nThis message arrived over MCP (caller: ${actorId}). There is no screen beside this reply — no pane, no cards to tap — so put the whole answer in the text, cite what you read inline, and if you filed a proposal or a question say so in words. The conversation is saved and a person can open it in the dashboard later.`;
}

/**
 * Ask the workspace: route (or address), run one turn, persist it. See the
 * module comment.
 *
 * Refuses, as a {@link WorkspaceTurnError}: an empty or over-long message
 * (`VALIDATION_FAILED`), an unknown slug (`AGENT_NOT_FOUND`, `details.available`
 * lists the active agents), an inactive agent (`AGENT_INACTIVE`), a
 * conversation this org does not own (`CONVERSATION_NOT_FOUND`), a workspace
 * with no active agent (`NO_AGENTS`), and an agent over budget
 * (`BUDGET_EXCEEDED`). A turn that fails inside the harness throws
 * `AGENT_FAILED` after the message is already in the conversation — the same
 * trail the web route leaves when a stream errors.
 * @param input - The turn.
 * @param overrides - Test seam; anything omitted uses the real thing.
 */
export async function askWorkspace(input: AskWorkspaceInput, overrides: Partial<WorkspaceTurnDeps> = {}): Promise<AskWorkspaceResult> {
  const deps: WorkspaceTurnDeps = { ...defaultDeps, ...overrides };
  const { orgId, actorId } = input;
  const message = input.message.trim();
  if (!message) {
    throw new WorkspaceTurnError('VALIDATION_FAILED', 'message is required');
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new WorkspaceTurnError('VALIDATION_FAILED', `message is longer than ${MAX_MESSAGE_CHARS} characters`);
  }

  const [agents, lead] = await Promise.all([listAgents(orgId), getWorkspaceLead(orgId)]);
  const activeSlugs = agents.filter(a => a.active === 'true').map(a => a.slug);

  // The conversation first: continuing one fixes the agent.
  let conversation: Awaited<ReturnType<typeof getConversation>> | undefined;
  if (input.conversationId !== undefined) {
    conversation = await getConversation({ orgId, id: input.conversationId });
    if (!conversation) {
      throw new WorkspaceTurnError('CONVERSATION_NOT_FOUND', `No conversation ${input.conversationId} in this workspace.`);
    }
  }

  let routing: RoutingDecision | null = null;
  let agentSlug: string;
  if (conversation) {
    agentSlug = conversation.agentSlug;
  } else if (input.agentSlug?.trim()) {
    agentSlug = input.agentSlug.trim();
  } else {
    routing = chooseAgent({ agents: agents.map(routableFromRow), message, leadSlug: lead.leadAgentSlug, surface: 'mcp' });
    if (!routing) {
      throw new WorkspaceTurnError('NO_AGENTS', 'This workspace has no active agent to answer. Author one and apply the workspace.');
    }
    agentSlug = routing.chosen;
  }

  const agent = agents.find(a => a.slug === agentSlug);
  if (!agent) {
    throw new WorkspaceTurnError('AGENT_NOT_FOUND', `No agent "${agentSlug}" in this workspace. Available: ${activeSlugs.length ? activeSlugs.join(', ') : 'none'}.`, { available: activeSlugs });
  }
  if (agent.active !== 'true') {
    throw new WorkspaceTurnError('AGENT_INACTIVE', `Agent "${agentSlug}" is inactive; set active: true in its manifest and apply the workspace to talk to it.`, { available: activeSlugs });
  }

  const budget = await deps.preflight({ orgId, agentSlug });
  if (!budget.ok) {
    throw new WorkspaceTurnError('BUDGET_EXCEEDED', `Agent "${agentSlug}" is over its ${budget.reason} budget for the period (${budget.current}/${budget.limit}). Raise the cap on /dashboard/agents/${agentSlug} or wait for the next period.`);
  }

  if (!conversation) {
    conversation = await createConversation({ orgId, agentSlug, createdBy: actorId, initialTitle: input.title?.trim() || undefined });
    await db.update(conversationSchema).set({ surface: 'mcp' }).where(eq(conversationSchema.id, conversation.id));
  }
  const conversationId = conversation.id;
  const autonomy = readAutonomy(conversation.autonomy);
  const modelPrefs = readModelPrefs(conversation);

  const [timeZone, allowedSourceSlugs, projectSlug] = await Promise.all([
    workspaceTimeZone(orgId),
    // A token has no membership, so a restricted source drops out for it — the
    // conservative reading of the same ACL a member's chat applies.
    allowedSourceSlugsForUser(orgId, actorId),
    projectSlugById(orgId),
  ]);

  // History BEFORE the new message, so the model does not see it twice. The
  // log keeps the message as typed, with the routing decision beside it.
  // Each of the agent's replayed turns carries what it ran (services/chat/historyTools.ts).
  const history = toHistoryTurns(await listMessages({ orgId, conversationId }), { timeZone });
  await appendMessage({ orgId, conversationId, role: 'user', content: message, userId: actorId, ...(routing ? { routing } : {}) });

  const collector = new RunCollector();
  const filed: FiledRun[] = [];
  const pending: Promise<void>[] = [];
  let traceId: string | null = null;
  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'response_delta':
        collector.onTextDelta(event.delta);
        break;
      case 'tool_start':
        collector.onToolStart(event.tool, event.input);
        break;
      case 'tool_end':
        collector.onToolEnd(event.tool, event.output);
        break;
      case 'tool_error':
        collector.onToolError(event.tool, event.message);
        break;
      case 'documents':
        collector.onDocuments(event.documents as CollectedDoc[]);
        break;
      case 'trace_node':
        collector.onTraceNode(event as unknown as Record<string, unknown>);
        break;
      case 'artifact':
        if (!event.pending) {
          collector.onArtifact(event.artifact.id);
        }
        break;
      case 'recommended_action':
        // Under `act-within-bounds` the web route files each card as it
        // arrives; a caller with no card to tap needs the same.
        if (autonomy === 'act-within-bounds' && event.recommendation.runId === undefined) {
          pending.push(autoProposeRecommendation({ orgId, userId: actorId, rec: event.recommendation }).then((runId) => {
            if (runId !== null) {
              filed.push({ runId, tool: 'recommend_action', outcome: null });
            }
          }));
        }
        break;
      case 'done':
        traceId = event.traceId ?? null;
        break;
      default: {
        const progress = event as unknown as ToolProgress;
        if (progress.type === 'tool_progress' && FILING_TOOLS.has(progress.tool) && typeof progress.meta?.runId === 'number') {
          filed.push({ runId: progress.meta.runId, tool: progress.tool, outcome: typeof progress.meta.outcome === 'string' ? progress.meta.outcome : null });
        }
      }
    }
  };

  const run = deps.runAgent({
    orgId,
    agentSlug,
    message: `${message}${surfaceNote(actorId)}`,
    userId: actorId,
    allowedSourceSlugs,
    conversationId,
    conversationHistory: history,
    timeZone,
    modelPrefs,
    onEvent,
  });

  const limit = input.timeLimitMs ?? turnTimeLimitMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), limit);
  });
  let outcome: 'timeout' | Awaited<ReturnType<typeof runAgentDeep>>;
  try {
    outcome = await Promise.race([run, timeout]);
  } catch (error) {
    clearTimeout(timer);
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkspaceTurnError('AGENT_FAILED', `Agent "${agentSlug}" did not finish the turn: ${reason}`);
  }
  clearTimeout(timer);

  const url = projectSlug
    ? workspaceUrl(projectSlug, `/dashboard/chat/${conversationId}`, { absolute: true })
    : `${appBaseUrl()}/dashboard/chat/${conversationId}`;
  const base = { agentSlug, agentName: agent.name, routing, conversationId, url };

  if (outcome === 'timeout') {
    const partial = collector.finalise();
    const seconds = Math.round(limit / 1000);
    const cutNote = `_(cut off at the ${seconds}-second limit for this surface; the rest of the answer lands in this conversation when the turn finishes.)_`;
    // `truncated`, not failed: the turn is still running and the rest lands in
    // this conversation as a `continued` row. Both halves are replayed to the
    // model, because between them they are one whole answer (#114).
    const turn = await appendMessage({ orgId, conversationId, role: 'assistant', content: partial.text ? `${partial.text}\n\n${cutNote}` : cutNote, runs: partial.runs, documents: partial.documents, trace: partial.trace, status: 'truncated', statusReason: `cut off at the ${seconds}-second limit for this surface` });
    void run
      .then(async (result) => {
        await Promise.allSettled(pending);
        const full = collector.finalise().text || result.response;
        const rest = full.startsWith(partial.text) ? full.slice(partial.text.length).trim() : full.trim();
        if (rest) {
          // Caught here rather than below: a write that fails is not the turn
          // failing, and saying "the turn failed after the cut" about a
          // deleted conversation would send someone looking at the agent.
          await appendMessage({ orgId, conversationId, role: 'assistant', content: rest, status: 'continued' }).catch((error: unknown) => {
            console.warn('ask_workspace: the rest of the answer could not be written down', { conversationId }, error);
          });
        }
      })
      .catch(async (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        // The half already shown stays `truncated` and stays in history; this
        // row says the rest never came, and is kept out of history because
        // there is no answer in it to replay.
        await appendMessage({ orgId, conversationId, role: 'assistant', content: `_(the turn failed after the cut: ${reason})_`, status: 'failed', statusReason: reason }).catch((error: unknown) => {
          console.warn('ask_workspace: could not write the turn-failed-after-the-cut row', { conversationId }, error);
        });
      });
    return { ...base, reply: partial.text, truncated: true, turnId: turn.id, traceId, actions: await actionsFor(orgId, projectSlug, filed) };
  }

  await Promise.allSettled(pending);
  const { text, runs, documents, trace } = collector.finalise();
  const reply = text || outcome.response;
  // A TURN THAT DID WORK AND NEVER ANSWERED IS NOT COMPLETE.
  //
  // Nothing threw and nothing was cut off, so this used to be stored as
  // `complete`: an empty answer under a spinner that stopped, with no notice
  // and no reason, and the person's only move is to ask again. It is not
  // rare — a reviewer that had already read the record it was asked to grade
  // ended four turns running on the word "Reading".
  const stalled = stoppedShort({ text: reply, toolCalls: trace.length });
  const turn = await appendMessage({
    orgId,
    conversationId,
    role: 'assistant',
    content: reply,
    runs,
    documents,
    trace,
    status: stalled ? 'stalled' : 'complete',
    ...(stalled ? { statusReason: `the turn ran ${trace.length} step${trace.length === 1 ? '' : 's'} and ended without answering` } : {}),
  });
  return { ...base, reply, truncated: false, turnId: turn.id, traceId: outcome.traceId || traceId, actions: await actionsFor(orgId, projectSlug, filed) };
}

/**
 * Read back the runs the turn filed, in the state they are in now — a
 * reversible write above the bar may already be `done`. Org-scoped like
 * every other read.
 * @param orgId - Tenant.
 * @param projectSlug - For the links; null leaves them null.
 * @param filed - What the events named, in order.
 */
async function actionsFor(orgId: string, projectSlug: string | null, filed: FiledRun[]): Promise<TurnAction[]> {
  const byId = new Map<number, FiledRun>();
  for (const f of filed) {
    if (!byId.has(f.runId)) {
      byId.set(f.runId, f);
    }
  }
  if (byId.size === 0) {
    return [];
  }
  const rows = await db
    .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, status: actionRunSchema.status, result: actionRunSchema.result })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, [...byId.keys()])));
  const rowById = new Map(rows.map(r => [r.id, r]));
  return [...byId.values()].flatMap((f) => {
    const row = rowById.get(f.runId);
    if (!row) {
      return [];
    }
    const askId = typeof row.result?.askId === 'number' ? row.result.askId : null;
    let url: string | null = null;
    if (projectSlug) {
      url = askId !== null ? askUrlFor(projectSlug, askId) : workspaceUrl(projectSlug, `/dashboard/inbox/proposal-${row.id}`, { absolute: true });
    }
    return [{ id: row.id, actionId: row.actionId, status: row.status, tool: f.tool, outcome: f.outcome, askId, url }];
  });
}
