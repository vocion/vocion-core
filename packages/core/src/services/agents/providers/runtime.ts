/**
 * BYOA runtime provider — `harness.provider: runtime`.
 *
 * Runs the agent on the standalone runtime artifact
 * (packages/agent-runtime) instead of the in-process deepagents loop.
 * The artifact is GENERIC: this provider assembles everything per
 * invocation — the compiled agent definition, mounted playbook/learning
 * files, the tool catalog, and a signed TenantClaim — and streams the
 * artifact's AgentEvents back to the caller verbatim, so the SSE route
 * and chat UI need no changes (same contract as the other providers).
 *
 * Where the artifact runs is configuration:
 *   - VOCION_AGENT_RUNTIME_ARN set → the deployed AgentCore Runtime,
 *     invoked via the AWS SDK (SigV4, streamed SSE response).
 *   - else VOCION_AGENT_RUNTIME_URL (default http://localhost:8080) →
 *     plain HTTP to a locally running artifact
 *     (npm run dev -w @vocion/agent-runtime).
 * Same artifact, same payload, same event stream — only the transport
 * differs. NOTE for the deployed path: the tool endpoint URL sent in
 * the payload must be reachable FROM AWS (VOCION_TOOL_ENDPOINT_URL);
 * localhost only works for the local transport.
 *
 * Bedrock credentials: the artifact has no database access and no KMS
 * grant, so it cannot resolve the org's stored AWS key itself. Core mints a
 * short-lived STS session from that key and sends it in the payload; the
 * artifact signs Bedrock with it, so model spend lands on the customer's
 * account. An org that stored no key sends no credential and the artifact
 * falls through to its own chain — the platform's secrets. See
 * `mintBedrockSessionForRuntime`.
 *
 * Budget accounting: the artifact can't reach the DB, so it emits
 * runtime-internal `usage` events per model turn; we charge
 * BudgetService here and do NOT forward those to the browser.
 */

import type { AgentEvent } from '../types';
import { Buffer } from 'node:buffer';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mintBedrockSessionForRuntime } from '@/libs/llm/bedrockCredentials';
import { agentSchema } from '@/models/Schema';
import { chargeUsage } from '@/services/BudgetService';
import { signClaim } from '../claims';
import { buildInitialFiles } from '../harness';
import { buildToolCatalog } from '../tools/registry';

const RUNTIME_URL = (): string => process.env.VOCION_AGENT_RUNTIME_URL ?? 'http://localhost:8080';
const TOOL_ENDPOINT = (): string =>
  process.env.VOCION_TOOL_ENDPOINT_URL
  ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/agent-tools`;

export type RuntimeRunOptions = {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  allowedSourceSlugs?: string[];
  missionSlug?: string;
  /** Persisted conversation id — keys the AgentCore Memory session (Phase 5). */
  conversationId?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onEvent?: (event: AgentEvent) => void;
};

export async function runAgentOnRuntime(opts: RuntimeRunOptions): Promise<{
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
}> {
  const emit = opts.onEvent ?? (() => {});

  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug)));
  if (!row) {
    throw new Error(`agent ${opts.agentSlug} not found`);
  }

  // The catalog needs the same ctx shape the endpoint rebuilds at
  // execution time — descriptions embed source/operation lists.
  const catalog = buildToolCatalog({
    orgId: opts.orgId,
    userId: opts.userId,
    citationSeq: { current: 0 },
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    allowedSourceSlugs: opts.allowedSourceSlugs,
    missionSlug: opts.missionSlug,
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as never) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    emit: () => {},
  });

  const claim = signClaim({
    orgId: opts.orgId,
    agentSlug: row.slug,
    userId: opts.userId,
    allowedSourceSlugs: opts.allowedSourceSlugs,
    missionSlug: opts.missionSlug,
    conversationId: opts.conversationId,
  });

  const files = await buildInitialFiles(opts.orgId, opts.agentSlug);
  const hc = row.harnessConfig ?? {};

  // Resolved for every run, not only for `modelProvider: bedrock` agents:
  // which vendor the artifact actually calls depends on ITS environment
  // (no ANTHROPIC_API_KEY means Bedrock), which core cannot see from here.
  // Sending the session whenever the org has one keeps the deployed path
  // billed to the customer without core having to guess.
  const awsSession = await mintBedrockSessionForRuntime(opts.orgId);

  // AgentCore Memory session (Phase 5, opt-in): keyed by the persisted
  // conversation. Default posture is belt-and-suspenders — history still
  // rides the payload and the artifact prefers whichever source is more
  // complete. VOCION_MEMORY_AUTHORITATIVE=1 omits payload history for
  // the real token savings once Memory-backed conversations are trusted.
  // The actor id MUST carry orgId, exactly like sessionId above: long-term
  // memory (facts/preferences, see memory.ts retrieveLongTerm) is namespaced
  // by actor alone, with no org dimension of its own. Without orgId here, a
  // user who belongs to two orgs would share one long-term memory across
  // both, and every run with no userId (missions, background work) would
  // collapse onto the single literal actor "system" shared by every org in
  // the memory store. This intentionally changes the actor id format, which
  // orphans any long-term records already written under the old unscoped
  // namespaces (`/facts/<userId-or-system>`, `/preferences/<userId-or-system>`)
  // — those records become unreachable. That is the point: an unscoped
  // record could belong to the wrong org, so leaving it unreachable is safer
  // than migrating it forward under a guessed org.
  const memorySession = process.env.VOCION_AGENTCORE_MEMORY_ID && opts.conversationId
    ? {
        sessionId: `vocion-conv-${opts.conversationId}-${opts.orgId}`.replace(/[^\w-]/g, '-').slice(0, 100),
        actorId: `${opts.orgId}-${opts.userId ?? 'system'}`.replace(/[^\w-]/g, '-').slice(0, 100),
      }
    : undefined;
  const omitHistory = memorySession && process.env.VOCION_MEMORY_AUTHORITATIVE === '1';

  const payload = {
    version: 1 as const,
    agent: {
      slug: row.slug,
      name: row.name,
      systemPrompt: row.systemPrompt,
      model: hc.model,
      temperature: row.temperature ? Number(row.temperature) : undefined,
      maxTokens: hc.maxTokens,
      subagents: (row.subagents ?? []).map(s => ({
        name: s.name,
        description: s.description,
        systemPrompt: s.systemPrompt,
      })),
      excludeTools: hc.excludeTools,
    },
    message: opts.message,
    conversationHistory: omitHistory ? undefined : opts.conversationHistory,
    files,
    tools: { endpoint: TOOL_ENDPOINT(), catalog, claim },
    ...(awsSession ? { aws: awsSession } : {}),
    trace: { orgId: opts.orgId, userId: opts.userId ?? 'system' },
    memory: memorySession,
  };

  // Relay the artifact's SSE stream. `usage` is consumed here (budget
  // charge), everything else forwards verbatim.
  let response = '';
  let traceId = '';
  const toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];
  let errorMessage: string | null = null;

  const handleEvent = async (event: AgentEvent): Promise<void> => {
    if (event.type === 'usage') {
      await chargeUsage({
        orgId: opts.orgId,
        agentSlug: opts.agentSlug,
        model: event.model,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
        },
      }).catch((err) => {
        // Charging is best-effort against the event stream — we never want a
        // billing hiccup to abort someone's chat turn — but a swallowed
        // failure here means budget enforcement silently stops working for
        // this org, with nothing in production logs to say so. Log it.
        console.error(
          `runtime provider: budget charge failed for org ${opts.orgId} agent ${opts.agentSlug} (usage NOT recorded): ${(err as Error).message}`,
        );
      });
      return;
    }
    if (event.type === 'tool_end') {
      toolCalls.push({ tool: event.tool, input: event.input, output: event.output });
      // Skill reads happen inside the artifact (file tools never cross the
      // transport), so capability usage is recorded here from the event
      // stream. Domain-tool rows are written by the tool endpoint instead.
      if (event.tool === 'read_file') {
        const path = typeof event.input?.file_path === 'string'
          ? event.input.file_path
          : (typeof event.input?.path === 'string' ? event.input.path : '');
        const m = path.match(/^\/(?:skills|playbooks)\/([^/]+)\//);
        if (m) {
          const { persistToolCall } = await import('../toolCallRecord');
          void persistToolCall({
            ctx: {
              orgId: opts.orgId,
              userId: opts.userId,
              agentSlug: opts.agentSlug,
              conversationId: opts.conversationId,
              provider: 'runtime',
              connectorSources: [],
              objectTypeSlugs: [],
              searchConfig: {},
              harnessConfig: {},
              emit: () => {},
              citationSeq: { current: 0 },
            },
            tool: 'skill_read',
            input: { slug: m[1], path },
            output: '',
            durationMs: 0,
            ns: '',
          });
        }
      }
    }
    if (event.type === 'tool_error') {
      // Logged here as well as inside the artifact, because this is the side
      // holding the org and agent — and because the most common cause is a
      // VOCION_TOOL_ENDPOINT_URL this deployment set wrong, where every tool
      // fails identically while the agent still answers fluently from the
      // model alone. The turn is deliberately NOT failed: the model has the
      // failure as that tool's output and may still give a useful answer.
      console.warn(
        `runtime provider: tool ${event.tool} failed for org ${opts.orgId} agent ${opts.agentSlug}`
        + `${event.status === undefined ? '' : ` (status ${event.status})`}: ${event.message}`,
      );
    }
    if (event.type === 'done') {
      response = event.response;
      traceId = event.traceId ?? '';
    }
    if (event.type === 'error') {
      errorMessage = event.message;
    }
    emit(event);
  };

  // SSE frame parser shared by both transports.
  let buffer = '';
  const handleChunk = async (chunk: string): Promise<void> => {
    buffer += chunk;
    let sep = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      const data = frame
        .split('\n')
        .filter(l => l.startsWith('data: '))
        .map(l => l.slice('data: '.length))
        .join('');
      if (!data) {
        continue; // keepalive comment frame
      }
      try {
        await handleEvent(JSON.parse(data) as AgentEvent);
      } catch (err) {
        // A truncated or malformed frame silently drops whatever event it
        // carried — possibly a response_delta, done, or error — which is
        // invisible in production if we say nothing. Log it, but keep
        // skipping just this one frame rather than aborting the stream:
        // one bad frame does not mean the rest of the run is unusable, and
        // ending the run here would lose a response the model may still
        // finish producing in later frames.
        console.warn(`agent runtime provider: dropped malformed SSE frame: ${(err as Error).message}`);
      }
    }
  };

  // Both transport branches below can fail before or during the stream
  // (SigV4 call rejected, HTTP connect refused, non-2xx response, stream
  // reader throwing mid-read). Previously nothing caught that: the promise
  // this function returns would reject, but a caller consuming `onEvent`
  // as an event stream would just see the stream end with no `error`
  // event — indistinguishable from the artifact quietly giving up. Emit a
  // typed error event first, mirroring loop.ts's own catch, then rethrow
  // so the caller's promise still rejects exactly as before.
  try {
    const runtimeArn = process.env.VOCION_AGENT_RUNTIME_ARN;
    if (runtimeArn) {
      // Deployed transport: InvokeAgentRuntime (SigV4) against AgentCore.
      const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import('@aws-sdk/client-bedrock-agentcore');
      const client = new BedrockAgentCoreClient({ region: process.env.VOCION_AGENTCORE_REGION ?? 'us-west-2' });
      const { randomUUID } = await import('node:crypto');
      const res = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: randomUUID(),
        ...(opts.userId ? { runtimeUserId: opts.userId } : {}),
        contentType: 'application/json',
        accept: 'text/event-stream',
        payload: Buffer.from(JSON.stringify(payload), 'utf8'),
      }));
      const stream = res.response as unknown as AsyncIterable<Uint8Array> | undefined;
      if (!stream) {
        throw new Error('agent runtime (AgentCore) returned no stream');
      }
      const decoder = new TextDecoder();
      for await (const value of stream) {
        await handleChunk(decoder.decode(value, { stream: true }));
      }
    } else {
      // Local transport: plain HTTP to the artifact.
      const res = await fetch(`${RUNTIME_URL()}/invocations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        throw new Error(`agent runtime returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await handleChunk(decoder.decode(value, { stream: true }));
      }
    }
  } catch (err) {
    const message = (err as Error).message ?? 'agent runtime transport failed';
    console.error(`agent runtime provider: transport failed for org ${opts.orgId} agent ${opts.agentSlug}: ${message}`);
    emit({ type: 'error', message });
    throw err;
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return { response, traceId, toolCalls };
}
