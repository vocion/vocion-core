/**
 * The action gates' real dependencies, and the two writes `proposeAction`
 * makes with them: which gates read this action in this workspace
 * (`project.enabled_plugins` → each plugin's `actionGates:`), the author's
 * vendor (its agent's harness), the critics the workspace can reach, the
 * words the action would publish (its own review card), the voice rules, the
 * wiki, the rubric, the charged model call, and the ledger of returns.
 *
 * The routing itself is pure and lives in `actionGate.ts`.
 */

import type { ActionGateDeps, CriticChoice, DeclaredGate, GateOutcome, GateRecord } from './actionGate';
import type { Action } from '@/libs/actions/types';
import type { LangChainProvider } from '@/libs/llm/langchain';
import type { ActionGateManifest } from '@/libs/workspace/schemas';
import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { lintCopy } from '@/libs/writing/voiceRules';
import { actionRunSchema, agentSchema, projectSchema } from '@/models/Schema';
import { declaredActionGates, gateOutcome, gatesForAction, publishableText, runActionGates, vendorOfModel, voiceFindings, voiceRulesText } from './actionGate';

/** The stamp a gate's return carries on the run it closed — a machine's decision (`libs/actions/decider.ts`). */
export const GATE_DECIDER_PREFIX = 'system:gate:';

/** How long a return counts toward "returned once already" for the same subject. */
const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Critics, in the order a workspace reaches for them. The gate skips the author's vendor. */
const CRITIC_PROVIDERS: readonly LangChainProvider[] = ['anthropic', 'openai', 'bedrock'];

/** Plugin manifests ship with core and do not change while it runs. */
const gatesByPlugin = new Map<string, ActionGateManifest[]>();

async function pluginGates(slug: string): Promise<ActionGateManifest[]> {
  const known = gatesByPlugin.get(slug);
  if (known) {
    return known;
  }
  const { loadPlugin } = await import('@/libs/workspace/plugins');
  let gates: ActionGateManifest[] = [];
  try {
    gates = loadPlugin(slug).manifest.actionGates ?? [];
  } catch {
    // A plugin that no longer ships declares nothing.
  }
  gatesByPlugin.set(slug, gates);
  return gates;
}

/**
 * The gates that read this action in this workspace, in plugin load order.
 * @param orgId - The project.
 * @param actionIds - The action's id and its former ids.
 */
export async function gatesForWorkspace(orgId: string, actionIds: readonly string[]): Promise<DeclaredGate[]> {
  // One indexed read on every proposal, and nothing else when no plugin is on
  // — the same column `enabledPluginsForOrg` reads, without its module graph.
  const [row] = await db.select({ enabledPlugins: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const enabled = row?.enabledPlugins ?? [];
  if (!Array.isArray(enabled) || enabled.length === 0) {
    return [];
  }
  const plugins = await Promise.all(enabled.map(async slug => ({ slug, actionGates: await pluginGates(slug) })));
  return gatesForAction(declaredActionGates(plugins), actionIds);
}

/**
 * The key the gate counts returns under: the action's own subject when it
 * names one (its dedup key — the recipient, the record), else whoever
 * proposed it. A revision of the same work lands on the same key.
 * @param actionId - The action.
 * @param dedupKey - The proposal's dedup key, when it has one.
 * @param invokedBy - Who proposed it.
 */
export function gateSubjectKey(actionId: string, dedupKey: string | null | undefined, invokedBy: string): string {
  return `gate:${actionId}:${dedupKey ?? invokedBy}`;
}

/**
 * The model an agent writes on, as a vendor. No agent (an API caller, a
 * person) reads as the workspace's default main model.
 * @param orgId - The project.
 * @param agentSlug - The agent whose draft this is, when known.
 */
async function authorVendor(orgId: string, agentSlug: string | null): Promise<ReturnType<typeof vendorOfModel>> {
  const { resolveProvider, resolvedModelIdFor } = await import('@/libs/llm/langchain');
  let harness: { modelProvider?: LangChainProvider; model?: string } = {};
  if (agentSlug) {
    const [row] = await db.select({ harness: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug))).limit(1);
    harness = (row?.harness ?? {}) as typeof harness;
  }
  const provider = harness.modelProvider ?? resolveProvider('main');
  const model = harness.modelProvider && harness.model ? harness.model : resolvedModelIdFor('main', provider);
  return vendorOfModel(provider, model);
}

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return Array.isArray(content) ? content.map(c => ((c as { type?: string; text?: string }).type === 'text' ? (c as { text?: string }).text ?? '' : '')).join('') : '';
}

/**
 * The real side effects for one proposal.
 * @param opts - The proposal.
 * @param opts.orgId - The project.
 * @param opts.action - The registered action.
 * @param opts.parsed - Its parsed input.
 * @param opts.authorAgentSlug - The agent whose draft this is, when known.
 * @param opts.subjectKey - Where returns are counted (`gateSubjectKey`).
 */
export function realActionGateDeps(opts: { orgId: string; action: Action; parsed: Record<string, unknown>; authorAgentSlug: string | null; subjectKey: string }): ActionGateDeps {
  const { orgId } = opts;
  return {
    author: () => authorVendor(orgId, opts.authorAgentSlug),
    candidates: async () => {
      const { buildChatModelForOrg, resolvedModelIdFor } = await import('@/libs/llm/langchain');
      const reachable: CriticChoice[] = [];
      for (const provider of CRITIC_PROVIDERS) {
        const model = resolvedModelIdFor('main', provider);
        try {
          // Building is how a key is found — the org's first, the server's
          // second — and it throws, naming the missing key, when neither is set.
          await buildChatModelForOrg('main', orgId, { provider, model, streaming: false });
          reachable.push({ provider, model, vendor: vendorOfModel(provider, model) });
        } catch {
          // Not reachable from this workspace.
        }
      }
      return reachable;
    },
    text: async () => {
      const card = opts.action.reviewCard ? await opts.action.reviewCard({ orgId }, opts.parsed).catch(() => null) : null;
      return publishableText(card as Parameters<typeof publishableText>[0], opts.parsed);
    },
    voice: async () => {
      const { voiceRulesFor } = await import('@/libs/writing/loadVoiceRules');
      const rules = await voiceRulesFor(orgId);
      return { rules, text: voiceRulesText(rules) };
    },
    lint: (text, rules) => voiceFindings(lintCopy(text, rules).violations),
    facts: async (text) => {
      const { wikiContextFor } = await import('@/services/wiki/wikiIndex');
      return (await wikiContextFor(orgId, text.slice(0, 1500), 4)).map(p => ({ title: p.title, slug: p.slug, excerpt: p.excerpt }));
    },
    rubric: async (slug) => {
      const { mountSkills } = await import('@/services/playbooks/mount');
      const files = await mountSkills({ orgId, skillSlugs: [slug], playbookSlugs: [] });
      return Object.entries(files).find(([path]) => path.includes(`/${slug}/`))?.[1] ?? null;
    },
    critique: async (choice, system, human) => {
      const [{ buildChatModelForOrg }, { HumanMessage, SystemMessage }, { traceFor, cleanUsageDetails }, { FEATURES }, { chargeModelCall }, { usageMetadataOf }] = await Promise.all([
        import('@/libs/llm/langchain'),
        import('@langchain/core/messages'),
        import('@/libs/Langfuse'),
        import('@/libs/Langfuse/features'),
        import('@/services/budget/chargeModelCall'),
        import('@/libs/llm/usage'),
      ]);
      const trace = traceFor({ feature: FEATURES.ACTION_GATE, slug: opts.action.id, orgId, userId: opts.authorAgentSlug ? `agent:${opts.authorAgentSlug}` : 'gate', input: { chars: human.length, critic: choice.model } });
      const generation = trace.generation({ name: 'critique', model: choice.model, input: human });
      const model = await buildChatModelForOrg('main', orgId, { provider: choice.provider, model: choice.model, temperature: 0, streaming: false, maxTokens: 1200 });
      const res = await model.invoke([new SystemMessage(system), new HumanMessage(human)], { signal: AbortSignal.timeout(60_000) });
      const raw = textOf(res.content);
      const usage = usageMetadataOf(res);
      generation.end({ output: raw, usageDetails: usage ? cleanUsageDetails({ input: usage.input_tokens, output: usage.output_tokens }) : undefined });
      // Every paid model call charges — to the agent whose draft it read, and the workspace.
      await chargeModelCall({ orgId, agentSlug: opts.authorAgentSlug ?? undefined, feature: FEATURES.ACTION_GATE, role: 'main', response: res });
      return raw;
    },
    priorReturns: async (gate: DeclaredGate) => {
      const [row] = await db
        .select({ n: count() })
        .from(actionRunSchema)
        .where(and(
          eq(actionRunSchema.orgId, orgId),
          eq(actionRunSchema.actionId, opts.action.id),
          eq(actionRunSchema.dedupKey, opts.subjectKey),
          eq(actionRunSchema.status, 'rejected'),
          eq(actionRunSchema.decidedBy, `${GATE_DECIDER_PREFIX}${gate.name}`),
          gte(actionRunSchema.createdAt, new Date(Date.now() - RETURN_WINDOW_MS)),
        ));
      return Number(row?.n ?? 0);
    },
  };
}

/**
 * Run the gates that read this action, when any do. Null when none apply —
 * the proposal goes on exactly as it did before gates existed.
 * @param opts - The proposal.
 * @param opts.orgId - The project.
 * @param opts.action - The registered action.
 * @param opts.parsed - Its parsed input.
 * @param opts.onPersonsWord - The person asked for it themselves: advice, never a stop.
 * @param opts.authorAgentSlug - The agent whose draft this is, when known.
 * @param opts.subjectKey - Where returns are counted.
 * @param opts.deps - Override the side effects (tests).
 */
export async function gateProposal(opts: { orgId: string; action: Action; parsed: Record<string, unknown>; onPersonsWord: boolean; authorAgentSlug: string | null; subjectKey: string; deps?: ActionGateDeps }): Promise<GateOutcome | null> {
  const gates = await gatesForWorkspace(opts.orgId, [opts.action.id, ...(opts.action.aliases ?? [])]).catch(() => [] as DeclaredGate[]);
  if (gates.length === 0) {
    return null;
  }
  const records = await runActionGates({ gates, actionLabel: opts.action.name, onPersonsWord: opts.onPersonsWord }, opts.deps ?? realActionGateDeps(opts));
  return gateOutcome(records);
}

/**
 * Put a return on the ledger: a run of the action, closed by the gate, with
 * its findings — so the next draft of the same work is counted as a revision,
 * and anyone reading the action's history sees what was sent back and why.
 * A machine's rejection never stands against a later proposal
 * (`decidedByMachine`), and its dedup key is the gate's own, so it never
 * collides with a card or an open run.
 * @param opts - The return.
 * @param opts.orgId - The project.
 * @param opts.actionId - The action.
 * @param opts.input - The input that was returned.
 * @param opts.proposal - The proposal envelope as it would have been stored.
 * @param opts.invokedBy - Who proposed it.
 * @param opts.subjectKey - Where returns are counted.
 * @param opts.record - The returning gate's record.
 * @param opts.records - Every gate's record.
 */
export async function recordGateReturn(opts: { orgId: string; actionId: string; input: Record<string, unknown>; proposal: Record<string, unknown> | null; invokedBy: string; subjectKey: string; record: GateRecord; records: GateRecord[] }): Promise<number | null> {
  const serious = opts.record.findings.filter(f => f.severity === 'serious').length;
  const [row] = await db.insert(actionRunSchema).values({
    orgId: opts.orgId,
    actionId: opts.actionId,
    input: opts.input,
    status: 'rejected',
    invokedBy: opts.invokedBy,
    proposal: { ...(opts.proposal ?? {}), gates: opts.records } as never,
    dedupKey: opts.subjectKey,
    error: `Returned to its author by ${opts.record.label}: ${serious} serious finding${serious === 1 ? '' : 's'}.`,
    decidedBy: `${GATE_DECIDER_PREFIX}${opts.record.gate}`,
    decidedAt: new Date(),
  }).returning({ id: actionRunSchema.id });
  return row?.id ?? null;
}
