/**
 * Scoped skill-turn executor — run ONE workspace skill in a single
 * tool-enabled model turn, with structured output and no mission scaffolding.
 *
 * A mission pass spends turns on ceremony that carries no judgment (read the
 * skill file, claim, save, update notes, report); this executor keeps the one
 * turn that matters. The skill and its attached playbooks are composed
 * straight into the prompt (the caller pre-fetches the common-case context so
 * no lookup is needed), the model keeps a small read-only tool belt for
 * lookups it chooses, and the answer comes back as a caller-typed structured
 * object the SERVER acts on — the turn itself can write nothing.
 *
 * Generic on purpose: Regenerate is caller #1; any future "quick action" that
 * needs one skill's judgment without a whole agent pass is caller #2. Which
 * skill answers for which job is the caller's configuration (for Regenerate,
 * the workspace's `defaults.regenerateSkills` mapping) — core never hardcodes
 * a workspace slug.
 */

import type { z } from 'zod';
import type { RuntimeContext } from '@/services/agents/types';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModelForOrg } from '@/libs/llm';
import { logger } from '@/libs/Logger';
import { agentSchema } from '@/models/Schema';
import { buildDomainTools } from '@/services/agents/tools/registry';
import { mountSkills } from '@/services/playbooks/mount';

export class SkillTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillTurnError';
  }
}

export type SkillTurnOptions<T> = {
  orgId: string;
  /** The ONE workspace skill this turn runs — mounted with its attached playbooks. */
  skillSlug: string;
  /** The per-run order: what to do right now. Context blocks ride separately. */
  task: string;
  /**
   * Pre-fetched context, composed into the turn so the common case needs no
   * lookup at all — the tool belt exists for what the caller could not know
   * to fetch.
   */
  context?: Array<{ title: string; body: string }>;
  /** The shape the turn must answer with; the caller saves it server-side. */
  outputSchema: z.ZodType<T>;
  /** Plain-language description of the output fields, shown with the JSON-only rule. */
  outputInstruction: string;
  /**
   * Read-only tool names the turn may call (resolved against the agent tool
   * registry, so grants and sources still gate them). Empty/omitted = no tools.
   */
  toolAllowlist?: string[];
  /**
   * Whose tool belt the turn borrows (connector sources, grants, search
   * config). Defaults to the agent that mounts the skill — the skill's
   * consumer lends its belt.
   */
  agentSlug?: string;
  /** Lookup budget. The default matches the plan: 3 calls / 60s. */
  maxToolCalls?: number;
  timeoutMs?: number;
  userId?: string;
};

export type SkillTurnResult<T> = {
  output: T;
  toolCalls: number;
  durationMs: number;
};

const DEFAULT_MAX_TOOL_CALLS = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
/** Model invocations, not tool calls: enough for the budget plus the answer and one parse retry. */
const MAX_MODEL_TURNS = 6;

/**
 * The message content as plain text, whichever shape the provider returned.
 * @param content
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(c => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

/**
 * Run one skill as a single scoped turn and return its structured output.
 * @param opts
 */
export async function runSkillTurn<T>(opts: SkillTurnOptions<T>): Promise<SkillTurnResult<T>> {
  const started = Date.now();
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Whose belt: the named agent, or the agent that mounts the skill. The
  // belt only widens what the READ tools may reach; the turn writes nothing.
  const agentWhere = opts.agentSlug
    ? and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug))
    : and(eq(agentSchema.orgId, opts.orgId), sql`${agentSchema.skillSlugs} @> ${JSON.stringify([opts.skillSlug])}::jsonb`);
  const [agent] = await db.select().from(agentSchema).where(agentWhere).orderBy(agentSchema.id).limit(1);
  if (!agent) {
    throw new SkillTurnError(
      opts.agentSlug
        ? `no agent "${opts.agentSlug}" in this workspace to lend the turn its tool belt`
        : `no agent mounts skill "${opts.skillSlug}", so the turn has no tool belt to borrow`,
    );
  }

  // The skill and its attached playbooks, from the same mounting machinery
  // the agent loop uses — one document on disk, every consumer.
  const mounted = await mountSkills({ orgId: opts.orgId, skillSlugs: [opts.skillSlug], playbookSlugs: [] });
  const entry = mounted[`/skills/${opts.skillSlug}/SKILL.md`];
  if (!entry) {
    throw new SkillTurnError(`skill "${opts.skillSlug}" is not applied to this workspace (no mounted SKILL.md)`);
  }
  const supporting = Object.entries(mounted)
    .filter(([path]) => path !== `/skills/${opts.skillSlug}/SKILL.md`)
    .map(([path, body]) => `--- ${path} ---\n${body}`);

  const ctx: RuntimeContext = {
    orgId: opts.orgId,
    userId: opts.userId,
    citationSeq: { current: 0 },
    agentSlug: agent.slug,
    connectorSources: agent.connectorSources ?? [],
    objectTypeSlugs: agent.objectTypeSlugs ?? [],
    searchConfig: (agent.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: agent.harnessConfig ?? {},
    emit: () => {},
  };

  // Allowlist by name against the registry, so grant/source gating still
  // applies — a name the gates withheld simply is not there to call.
  const allow = new Set(opts.toolAllowlist ?? []);
  const exclude = new Set(ctx.harnessConfig.excludeTools ?? []);
  const tools = allow.size > 0
    ? buildDomainTools(ctx).filter(t => allow.has(t.name) && !exclude.has(t.name))
    : [];

  const base = await buildChatModelForOrg('skillTurn', opts.orgId, { temperature: 0.3, streaming: false, maxTokens: 8000 });
  if (tools.length > 0 && !base.bindTools) {
    throw new SkillTurnError('the skillTurn model does not support tool binding');
  }
  const model = tools.length > 0 ? base.bindTools!(tools) : base;

  const system = [
    'You are executing ONE skill in a single scoped turn. The skill document below is your procedure; its attached playbooks carry the depth. Follow them exactly.',
    `--- /skills/${opts.skillSlug}/SKILL.md ---\n${entry}`,
    ...supporting,
    tools.length > 0
      ? `You may call the available read-only tools when the task needs something your context lacks, up to ${maxToolCalls} calls in total. Prefer answering from the context you were given.`
      : 'You have no tools this turn: answer from the context you were given.',
    `When you answer, output ONLY a JSON object, no prose and no code fences. ${opts.outputInstruction}`,
  ].join('\n\n');

  const contextBlocks = (opts.context ?? []).map(c => `## ${c.title}\n\n${c.body}`).join('\n\n');
  const user = contextBlocks ? `${contextBlocks}\n\n## Task\n\n${opts.task}` : opts.task;

  const trace = traceFor({
    feature: FEATURES.SKILL_TURN,
    slug: opts.skillSlug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { skill: opts.skillSlug, agent: agent.slug, tools: tools.map(t => t.name) },
  });

  const signal = AbortSignal.timeout(timeoutMs);
  const messages: Array<SystemMessage | HumanMessage | ToolMessage | Awaited<ReturnType<typeof model.invoke>>> = [
    new SystemMessage(system),
    new HumanMessage(user),
  ];
  let toolCallsUsed = 0;

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
    const generation = trace.generation({ name: `skill-turn-${turn}`, model: 'skillTurn', input: turn === 0 ? user : undefined });
    const res = await model.invoke(messages as never, { signal });
    const raw = contentText(res.content);
    const usage = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
    generation.end({
      output: raw || `(tool calls: ${(res.tool_calls ?? []).map(c => c.name).join(', ')})`,
      usageDetails: usage ? cleanUsageDetails({ input: usage.input_tokens, output: usage.output_tokens }) : undefined,
    });

    const calls = res.tool_calls ?? [];
    if (calls.length > 0) {
      messages.push(res);
      for (const call of calls) {
        if (toolCallsUsed >= maxToolCalls) {
          messages.push(new ToolMessage({
            content: 'Tool budget exhausted. Answer now with the JSON output, from what you already have.',
            tool_call_id: call.id ?? `call-${toolCallsUsed}`,
          }));
          continue;
        }
        toolCallsUsed += 1;
        const toolObj = tools.find(t => t.name === call.name);
        let output: string;
        if (!toolObj) {
          output = `Tool error: ${call.name} is not available this turn.`;
        } else {
          try {
            const out = await toolObj.invoke(call.args as never);
            output = typeof out === 'string' ? out : JSON.stringify(out);
          } catch (err) {
            // The model should see the failure and recover, same contract as
            // the agent loop's tool endpoint.
            output = `Tool error: ${(err as Error).message ?? 'unknown'}`;
          }
        }
        messages.push(new ToolMessage({ content: output, tool_call_id: call.id ?? `call-${toolCallsUsed}` }));
      }
      continue;
    }

    // The answer: JSON only, fences tolerated, validated by the caller's
    // schema. One corrective retry — a malformed answer is told exactly what
    // failed; a second failure is the caller's error to handle.
    const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
    try {
      const output = opts.outputSchema.parse(JSON.parse(stripped));
      trace.update({ output: { toolCallsUsed, durationMs: Date.now() - started } });
      return { output, toolCalls: toolCallsUsed, durationMs: Date.now() - started };
    } catch (err) {
      logger.warn('skill turn answer failed to parse — one corrective retry', {
        skillSlug: opts.skillSlug,
        orgId: opts.orgId,
        error: err instanceof Error ? err.message : String(err),
      });
      messages.push(res);
      messages.push(new HumanMessage(
        `Your answer did not validate: ${err instanceof Error ? err.message : String(err)}. Answer again with ONLY the JSON object, no prose, no fences. ${opts.outputInstruction}`,
      ));
    }
  }

  throw new SkillTurnError(`skill turn for "${opts.skillSlug}" did not converge within ${MAX_MODEL_TURNS} model turns`);
}
