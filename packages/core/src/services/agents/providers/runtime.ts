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
 * Budget accounting: the artifact can't reach the DB, so it emits
 * runtime-internal `usage` events per model turn; we charge
 * BudgetService here and do NOT forward those to the browser.
 */

import type { AgentEvent } from '../types';
import { Buffer } from 'node:buffer';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
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
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    allowedSourceSlugs: opts.allowedSourceSlugs,
    missionSlug: opts.missionSlug,
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as never) ?? {},
    operationSlugs: row.skillSlugs ?? [],
    harnessConfig: row.harnessConfig ?? {},
    emit: () => {},
  });

  const claim = signClaim({
    orgId: opts.orgId,
    agentSlug: row.slug,
    userId: opts.userId,
    allowedSourceSlugs: opts.allowedSourceSlugs,
    missionSlug: opts.missionSlug,
  });

  const files = await buildInitialFiles(opts.orgId, opts.agentSlug);
  const hc = row.harnessConfig ?? {};

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
    conversationHistory: opts.conversationHistory,
    files,
    tools: { endpoint: TOOL_ENDPOINT(), catalog, claim },
    trace: { orgId: opts.orgId, userId: opts.userId ?? 'system' },
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
      }).catch(() => {});
      return;
    }
    if (event.type === 'tool_end') {
      toolCalls.push({ tool: event.tool, input: event.input, output: event.output });
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
      } catch {
        /* skip malformed frames rather than killing the run */
      }
    }
  };

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

  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return { response, traceId, toolCalls };
}
