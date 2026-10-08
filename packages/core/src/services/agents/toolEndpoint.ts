/**
 * Claim-verified tool execution — the core side of the transport seam.
 *
 * The BYOA runtime artifact (packages/agent-runtime) executes NO domain
 * tools itself; it POSTs { tool, input } here with the invocation's
 * signed TenantClaim. We verify the claim, rebuild the exact
 * RuntimeContext the in-process harness would have used — FROM THE
 * CLAIM AND THE AGENT ROW, never from the request body — execute the
 * tool, and hand back its output plus any side-channel events it
 * emitted (documents, skill_result, hitl_gate…), which the artifact
 * re-emits into its SSE stream.
 *
 * Tenancy invariant: `orgId`, `userId`, `allowedSourceSlugs`, `missionSlug`,
 * `missionRunId`, `timeZone` and `pageContext` come exclusively from the
 * verified claim; the plugin list and the workspace zone are read from the
 * database for the claimed org. A caller can
 * only ever act inside the tenant scope core itself signed.
 */

import type { AgentEvent } from './types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema } from '@/models/Schema';
import { verifyClaim } from './claims';
import { runtimeContextForAgent } from './runtimeContext';
import { buildDomainTools } from './tools/registry';

export type ToolCallOutcome
  = | { ok: true; output: string; events: AgentEvent[] }
    | { ok: false; status: 401 | 403 | 404 | 500; error: string };

export async function executeToolCall(opts: {
  token: string;
  tool: string;
  input: Record<string, unknown>;
  /**
   * checkpoint_ns of the invocation inside the artifact's loop —
   * attribution metadata for the tool_call record, never a tenancy
   * input. Optional: older artifacts don't send it.
   */
  ns?: string;
}): Promise<ToolCallOutcome> {
  const verified = verifyClaim(opts.token);
  if (!verified.ok) {
    return { ok: false, status: 401, error: `invalid claim: ${verified.reason}` };
  }
  const claim = verified.claim;

  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, claim.orgId), eq(agentSchema.slug, claim.agentSlug)));
  if (!row) {
    // The claim names an agent that doesn't exist in that org — either
    // stale or forged-scope; both are a refusal, not a 500.
    return { ok: false, status: 403, error: `agent ${claim.agentSlug} not found in claimed org` };
  }

  const events: AgentEvent[] = [];
  // The same context the in-process harness builds — plugins, zone, typed
  // filing tools and REST sources included — read per call because this
  // endpoint has no graph. Per-call facts come from the claim alone.
  const ctx = await runtimeContextForAgent(claim.orgId, row, {
    userId: claim.userId,
    allowedSourceSlugs: claim.allowedSourceSlugs,
    missionSlug: claim.missionSlug,
    missionRunId: claim.missionRunId,
    conversationId: claim.conversationId,
    pageContext: claim.pageContext,
    timeZone: claim.timeZone,
    ...(claim.rendersCards ? { rendersCards: true } : {}),
    provider: 'runtime',
    emit: e => events.push(e),
  });

  const excludeTools = new Set(ctx.harnessConfig.excludeTools ?? []);
  const toolObj = buildDomainTools(ctx).find(t => t.name === opts.tool && !excludeTools.has(t.name));
  if (!toolObj) {
    return { ok: false, status: 404, error: `unknown tool: ${opts.tool}` };
  }

  try {
    // The ns rides in as config metadata so the tool-call record can
    // attribute a delegated specialist's call, mirroring the local loop.
    const raw = await toolObj.invoke(
      opts.input as never,
      opts.ns ? ({ metadata: { checkpoint_ns: opts.ns } } as never) : undefined,
    );
    const output = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return { ok: true, output, events };
  } catch (err) {
    // Tool errors return 200-shaped tool failures upstream (the model
    // should see them and recover); transport-level 500 is reserved for
    // our own bugs. Mirror the in-process behavior: message as output.
    return { ok: true, output: `Tool error: ${(err as Error).message ?? 'unknown'}`, events };
  }
}
