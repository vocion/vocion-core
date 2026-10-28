/**
 * Amplitude Agent Analytics: every paid model call and every tool call an
 * agent makes, as `[Agent]` events; every action a person takes on the
 * adoption stream (`chat.message_sent`, `review.decided`, …); and how each
 * chat turn ended (`chat.turn_completed`). Chat volume is the messages: a
 * model call counts work, and one turn makes dozens.
 *
 * Fed from the two write paths every runtime already shares: the spend ledger
 * (`services/spend/ledger.ts`, one row per model call) and the tool-call record
 * (`services/agents/toolCallRecord.ts`). A LangChain callback would see only
 * the in-process loop; agents on the AgentCore container would go untracked.
 *
 * Off unless the workspace has a key: the System Keys card on System (the
 * instance) or Developers (one workspace), else `AMPLITUDE_API_KEY`
 * (`services/analytics/amplitudeKey.ts`). Each event goes to the key of the
 * workspace it happened in, one client per key, so no workspace's events land
 * in another's project.
 *
 * Metadata only: model, tokens, cost, latency, tool name and outcome. No
 * prompt, reply or tool payload leaves the instance, because they carry
 * client records. Every event carries `workspace_id` and `workspace_name` as
 * plain properties, so any chart breaks down by workspace.
 *
 * Never throws and never waits: events queue and the SDK sends them on its
 * own interval. Telemetry is a record of the work, not part of it.
 */

import process from 'node:process';
import { personIdOf } from '@/services/agents/personId';

type Client = {
  ai: import('@amplitude/ai').AmplitudeAI;
  /** The plain client under it, for product events. */
  amplitude: ReturnType<typeof import('@amplitude/analytics-node').createInstance>;
};

const clients = new Map<string, Promise<Client | null>>();

async function start(apiKey: string): Promise<Client | null> {
  try {
    // Our own import, not the SDK's `apiKey` path: that one loads analytics-node
    // with a runtime require the standalone trace cannot see, so prod shipped without it.
    const [{ AmplitudeAI, AIConfig }, { createInstance }] = await Promise.all([import('@amplitude/ai'), import('@amplitude/analytics-node')]);
    const amplitude = createInstance();
    void amplitude.init(apiKey).promise.catch((error: unknown) => console.error('[amplitude] agent analytics did not initialise', error));
    return { ai: new AmplitudeAI({ amplitude, config: new AIConfig({ contentMode: 'metadata_only' }) }), amplitude };
  } catch (error) {
    console.error('[amplitude] could not start agent analytics; continuing without it', error);
    return null;
  }
}

async function clientFor(orgId: string): Promise<Client | null> {
  const { amplitudeKeyFor } = await import('@/services/analytics/amplitudeKey');
  const apiKey = await amplitudeKeyFor(orgId);
  if (!apiKey) {
    return null;
  }
  let client = clients.get(apiKey);
  if (!client) {
    client = start(apiKey);
    clients.set(apiKey, client);
  }
  return client;
}

/**
 * The one identity unattended work is filed under. Amplitude counts every
 * identity as a user, so giving each automation, token or workspace its own
 * turned 6 people into 33 "users"; this way the count is the people plus one.
 */
const UNATTENDED = 'vocion-agents';

/** Who the event is about. */
type Identity = {
  orgId: string;
  userId?: string | null;
  conversationId?: number | null;
  runId?: string | number | null;
  traceId?: string | null;
};

async function identityOf(who: Identity) {
  const { workspaceNameOf } = await import('@/services/analytics/workspaceName');
  const workspaceName = await workspaceNameOf(who.orgId);
  const person = personIdOf(who.userId);
  const sessionId = who.conversationId != null
    ? `conversation:${who.conversationId}`
    : who.runId != null ? `run:${who.runId}` : who.traceId ? `trace:${who.traceId}` : `workspace:${who.orgId}`;
  return {
    ...(person ? { userId: person } : { deviceId: UNATTENDED }),
    sessionId,
    customerOrgId: who.orgId,
    env: process.env.NODE_ENV ?? null,
    // The same group the browser sets, so a workspace's people and agents line up.
    groups: { workspace: who.orgId },
    // Who started it when no person did: `automation:<slug>`, `token:<id>`, or nothing.
    eventProperties: { actor: person ?? who.userId ?? 'unattended', workspace_id: who.orgId, workspace_name: workspaceName },
  };
}

export type AgentModelCall = Identity & {
  agentSlug: string | null;
  feature: string;
  model: string;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  microCents: number;
  latencyMs: number | null;
};

/**
 * `[Agent] AI Response` for one paid model call.
 * @param call - The spend-ledger row.
 */
export async function trackAgentModelCall(call: AgentModelCall): Promise<void> {
  try {
    const client = await clientFor(call.orgId);
    if (!client) {
      return;
    }
    client.ai.trackAiMessage({
      ...(await identityOf(call)),
      content: '',
      model: call.model,
      provider: call.provider ?? 'unknown',
      latencyMs: call.latencyMs ?? 0,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheCreationTokens: call.cacheWriteTokens,
      // A micro-cent is a millionth of a cent.
      totalCostUsd: call.microCents / 100_000_000,
      agentId: call.agentSlug ?? call.feature,
      traceId: call.traceId ?? null,
      context: { feature: call.feature },
    });
  } catch (error) {
    console.error('[amplitude] model call not tracked', error);
  }
}

export type AgentToolCall = Identity & {
  agentSlug: string;
  leadAgentSlug: string | null;
  tool: string;
  durationMs: number;
  error: string | null;
};

/**
 * `[Agent] Tool Call` for one tool invocation. Name and outcome only.
 * @param call - The tool-call record.
 */
export async function trackAgentToolCall(call: AgentToolCall): Promise<void> {
  try {
    const client = await clientFor(call.orgId);
    if (!client) {
      return;
    }
    client.ai.trackToolCall({
      ...(await identityOf(call)),
      toolName: call.tool,
      latencyMs: call.durationMs,
      success: call.error === null,
      agentId: call.agentSlug,
      parentAgentId: call.leadAgentSlug,
      traceId: call.traceId ?? null,
    });
  } catch (error) {
    console.error('[amplitude] tool call not tracked', error);
  }
}

async function trackProduct(orgId: string, userId: string, eventType: string, properties: Record<string, unknown>): Promise<void> {
  try {
    const client = await clientFor(orgId);
    if (!client) {
      return;
    }
    const who = await identityOf({ orgId, userId });
    client.amplitude.track(eventType, { ...who.eventProperties, ...properties }, {
      ...('userId' in who ? { user_id: who.userId } : { device_id: who.deviceId }),
      groups: who.groups,
    });
  } catch (error) {
    console.error(`[amplitude] ${eventType} not tracked`, error);
  }
}

/** One event from the adoption stream (`services/adoption/track.ts`). */
export type ProductEvent = {
  orgId: string;
  userId: string;
  /** The adoption event type, kept as its Amplitude name: `chat.message_sent`, `review.decided`, … */
  eventType: string;
  agentSlug: string | null;
  resourceType: string | null;
  meta: Record<string, unknown> | null;
};

/**
 * A person's action from the adoption stream, under the same name the Adoption
 * page counts it by, so Vocion's numbers and Amplitude's agree.
 * @param event - The adoption event.
 */
export async function trackProductEvent(event: ProductEvent): Promise<void> {
  await trackProduct(event.orgId, event.userId, event.eventType, {
    ...event.meta,
    agent: event.agentSlug,
    resource_type: event.resourceType,
  });
}

/** How one chat turn a person started ended (`rpc/agent/stream`). */
export type ChatTurnEnd = {
  orgId: string;
  userId: string;
  conversationId: number | null;
  agentSlug: string;
  /** The feature the person sent it from (`libs/analytics/featureOf.ts`): `chat`, `review`, … */
  feature: string;
  /** What the person asked for: `auto`, `quick`, `standard`, `deep`. */
  effortChoice: string;
  /** The level the turn ran at, when it reported one. */
  effortLevel: string | null;
  /** `complete`, `stopped`, `stalled`, `incomplete`, `failed`, `refused`. */
  ending: string;
  durationMs: number;
  toolCalls: number;
  microCents: number;
};

/**
 * `chat.turn_completed`: the answer to one `chat.message_sent`, with how it
 * ended, how long it took and what it cost.
 * @param turn - The finished turn.
 */
export async function trackChatTurn(turn: ChatTurnEnd): Promise<void> {
  await trackProduct(turn.orgId, turn.userId, 'chat.turn_completed', {
    agent: turn.agentSlug,
    conversation_id: turn.conversationId,
    feature: turn.feature,
    effort_choice: turn.effortChoice,
    effort_level: turn.effortLevel,
    ending: turn.ending,
    duration_ms: turn.durationMs,
    tool_calls: turn.toolCalls,
    cost_usd: turn.microCents / 100_000_000,
  });
}

export function resetAmplitudeForTests(): void {
  clients.clear();
}
