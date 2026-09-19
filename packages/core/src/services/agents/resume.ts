/**
 * Replaying the call a connect card interrupted.
 *
 * The weak version of resume is to re-send the question and let the model
 * decide again. This is the structural one: the tool and the arguments were
 * already chosen when the stub fired, so the grant landing means the call can
 * simply be MADE — in core, deterministically — and its output handed to the
 * turn as grounding. No second round of deciding, and no chance of the model
 * asking itself a slightly different question than the one the person asked.
 *
 * (`docs/DESIGN-PRINCIPLES.md`, and the "structural over prompting" convention:
 * when a behaviour is a requirement, enforce it in code rather than iterating
 * on wording.)
 */

import type { ConnectionIntent } from './connectionIntent';
import type { AgentEvent, RuntimeContext } from './types';
import type { Actor } from '@/services/SourceCredentialService';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema } from '@/models/Schema';
import { capabilityLedger } from './capabilityLedger';
import { claimIntent } from './connectionIntent';
import { buildDomainTools } from './tools/registry';

export type ReplayOutcome
  /** The call was made and this is what it returned. */
  = | { ok: true; tool: string; output: string; events: AgentEvent[] }
    /** Nothing was replayed, and why — the caller falls back to re-asking. */
    | { ok: false; reason: 'claimed' | 'unknown-agent' | 'tool-absent' | 'still-unconnected' | 'failed' };

/**
 * Make the call the stub intercepted, now that the credential exists.
 *
 * Claims the intent first: two tabs finishing one consent, or a callback the
 * browser retried, must not each run the read.
 * @param input - Which call to replay, and as whom.
 * @param input.orgId - Tenant.
 * @param input.agentSlug - The agent whose tool surface the call belongs to.
 * @param input.actor - Who the replay runs as; a personal credential resolves for a person.
 * @param input.role - The requester's role, for the ledger.
 * @param input.intent - The saved call.
 */
export async function replayIntent(input: {
  orgId: string;
  agentSlug: string;
  actor: Actor;
  role?: string | null;
  intent: ConnectionIntent;
}): Promise<ReplayOutcome> {
  if (!(await claimIntent(input.intent.id))) {
    return { ok: false, reason: 'claimed' };
  }

  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, input.orgId), eq(agentSchema.slug, input.agentSlug)));
  if (!row) {
    return { ok: false, reason: 'unknown-agent' };
  }

  // Read fresh, not from the cached graph: the whole reason we are here is
  // that the ledger changed a moment ago.
  const ledger = await capabilityLedger(input.orgId, { actor: input.actor, role: input.role });
  const capability = ledger.get(input.intent.connectorSlug);
  if (capability && capability.state.kind !== 'ready') {
    // The consent came back but the credential is not usable — a cancelled
    // consent, or a grant for a different account. Saying so beats replaying
    // into the same stub and emitting a second identical card.
    return { ok: false, reason: 'still-unconnected' };
  }

  const events: AgentEvent[] = [];
  const ctx: RuntimeContext = {
    orgId: input.orgId,
    actor: input.actor,
    role: input.role,
    ledger,
    userId: input.actor.kind === 'user' ? input.actor.id : undefined,
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    conversationId: input.intent.conversationId ?? undefined,
    emit: e => events.push(e),
    citationSeq: { current: 0 },
  };

  const tool = buildDomainTools(ctx).find(t => t.name === input.intent.tool);
  if (!tool) {
    // The agent's surface changed under the intent — a renamed tool, a grant
    // withdrawn. Re-asking is the honest fallback.
    return { ok: false, reason: 'tool-absent' };
  }

  try {
    const output = await tool.invoke(input.intent.args);
    return { ok: true, tool: input.intent.tool, output: typeof output === 'string' ? output : JSON.stringify(output), events };
  } catch (err) {
    console.error('[resume] replaying the intercepted call failed', {
      tool: input.intent.tool,
      connectorSlug: input.intent.connectorSlug,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'failed' };
  }
}

/**
 * The replayed output, as a block the turn is grounded in.
 *
 * Labelled with the tool it came from rather than pasted in bare, so the model
 * treats it as a reading it already has and the trace can say where the
 * answer's evidence came from (principle 10).
 * @param tool - The tool that produced it.
 * @param output - What it returned.
 */
export function groundingFromReplay(tool: string, output: string): string {
  return `--- ${tool} (just connected, read for this turn) ---\n${output}`;
}
