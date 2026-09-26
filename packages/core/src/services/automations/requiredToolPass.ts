/**
 * The required tool, forced: one focused pass over work already written.
 *
 * WHY (red team, 2026-09-26, fire 7040): the reviewer wrote a sound verdict
 * in prose — "changes, 0 of 6 frozen criteria proven" — and ended without
 * calling `record_verdict`, which it held. A second full pass with "end with
 * it" in the brief re-read the same PR and did the same thing. Asking again is
 * a prompt lever; this is the backstop lever (the pattern of
 * `recommendActionBackstop`): the finished report goes to the model with the
 * tool bound and CHOSEN, so the only possible output is the call. The model
 * transcribes its own conclusion into the typed shape; it decides nothing new.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '@/services/agents/types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, missionRunSchema } from '@/models/Schema';

/**
 * Everything the run wrote, in task order — the report the pass transcribes.
 * @param orgId - The workspace.
 * @param missionRunId - The run that ended without the tool.
 */
export async function missionRunReport(orgId: string, missionRunId: number): Promise<string> {
  const [row] = await db
    .select({ plan: missionRunSchema.plan })
    .from(missionRunSchema)
    .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, missionRunId)))
    .limit(1);
  const tasks = (row?.plan as { tasks?: Array<{ output?: unknown }> } | null)?.tasks ?? [];
  return tasks.map(t => (typeof t.output === 'string' ? t.output : '')).filter(Boolean).join('\n\n').trim();
}

/**
 * Force one call of `toolName` carrying what the run's report concluded.
 * @param opts - What to force, for whom, over which report.
 * @param opts.orgId - The workspace.
 * @param opts.agentSlug - The agent whose tool belt (and grants) the call uses.
 * @param opts.toolName - The tool the automation requires.
 * @param opts.missionRunId - The run the call is recorded against.
 * @param opts.report - The run's written report.
 * @param opts.context - What the fire was about (the event payload), as JSON.
 * @returns Whether an accepted call landed, and the tool's last answer.
 */
export async function forceRequiredTool(opts: {
  orgId: string;
  agentSlug: string;
  toolName: string;
  missionRunId: number;
  report: string;
  context?: Record<string, unknown>;
}): Promise<{ called: boolean; answer: string }> {
  if (!opts.report) {
    return { called: false, answer: 'the run wrote no report to record' };
  }
  const [agent] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug))).limit(1);
  if (!agent) {
    return { called: false, answer: `no agent "${opts.agentSlug}" in this workspace` };
  }
  const ctx: RuntimeContext = {
    orgId: opts.orgId,
    citationSeq: { current: 0 },
    agentSlug: agent.slug,
    connectorSources: agent.connectorSources ?? [],
    objectTypeSlugs: agent.objectTypeSlugs ?? [],
    searchConfig: (agent.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: agent.harnessConfig ?? {},
    missionRunId: opts.missionRunId,
    emit: () => {},
  } as RuntimeContext;
  const { buildDomainTools } = await import('@/services/agents/tools/registry');
  const tool = buildDomainTools(ctx).find(t => t.name === opts.toolName) as StructuredToolInterface | undefined;
  if (!tool) {
    return { called: false, answer: `${opts.agentSlug} does not hold ${opts.toolName} (not granted, or excluded)` };
  }
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage, ToolMessage } = await import('@langchain/core/messages');
  const base = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 6000 });
  if (!base.bindTools) {
    return { called: false, answer: 'the model cannot bind tools' };
  }
  const model = base.bindTools([tool], { tool_choice: opts.toolName } as never);
  const messages: BaseMessage[] = [
    new SystemMessage(`${agent.systemPrompt ?? ''}\n\nRECORDING PASS: the report below is your own finished work. Your only job is to call ${opts.toolName} once, carrying exactly what the report concluded — the same verdict, the same judgement of each item, the same evidence. Do not re-judge and do not soften it.`),
    new HumanMessage(`${opts.context ? `What this was about:\n${JSON.stringify(opts.context)}\n\n` : ''}Your report:\n\n${opts.report.slice(0, 40_000)}`),
  ];
  let answer = '';
  // Two tries: a refusal ("Not recorded: …") names what to fix, and the
  // second call gets to fix it. Nothing more — this is a backstop, not a loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await model.invoke(messages as never);
    const call = (res.tool_calls ?? []).find(c => c.name === opts.toolName);
    if (!call) {
      return { called: false, answer: answer || 'the model returned no tool call' };
    }
    // A call that misses the tool's own schema is a refusal too: it names what
    // to fix, and the second try gets to fix it (fire 7051).
    answer = await tool.invoke(call.args).then(String, (err: Error) => `Not recorded: the call did not match the tool's schema. ${err.message}`);
    if (!answer.startsWith('Not recorded')) {
      return { called: true, answer };
    }
    messages.push(res as BaseMessage, new ToolMessage({ content: answer, tool_call_id: call.id ?? `${opts.toolName}-${attempt}` }));
  }
  return { called: false, answer };
}
