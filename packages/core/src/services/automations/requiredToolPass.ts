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
  // THE PASS LOOKS, IN CODE. Review run 5638 was refused twice for judging
  // fifteen screenshots it never opened — the refusal listed every link — and
  // it called record_verdict again instead of opening one (2026-09-27). When
  // the run's last refusal lists screenshots, this pass fetches them
  // server-side, records each as opened, and puts the pictures in front of the
  // model beside its report, so the verdict is taken looking at the evidence.
  const shots = await shotsFromRefusal(ctx, opts.toolName);
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage, ToolMessage } = await import('@langchain/core/messages');
  const base = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 6000 });
  if (!base.bindTools) {
    return { called: false, answer: 'the model cannot bind tools' };
  }
  const model = base.bindTools([tool], { tool_choice: opts.toolName } as never);
  const messages: BaseMessage[] = [
    new SystemMessage(`${agent.systemPrompt ?? ''}\n\nRECORDING PASS: the report below is your own finished work. Your only job is to call ${opts.toolName} once, carrying what the report concluded${shots.length > 0 ? ', corrected by what the attached screenshots actually show' : ' — the same verdict, the same judgement of each item, the same evidence. Do not re-judge and do not soften it'}.`),
    new HumanMessage({
      content: [
        { type: 'text', text: `${opts.context ? `What this was about:\n${JSON.stringify(opts.context)}\n\n` : ''}Your report:\n\n${opts.report.slice(0, 40_000)}${shots.length > 0 ? `\n\nThe screenshots, opened for you. Judge each criterion by what these show, and cite the link of the one that proves it:` : ''}` },
        ...shots.flatMap(shot => [
          { type: 'text' as const, text: `${shot.title}: ${shot.link}` },
          { type: 'image_url' as const, image_url: { url: shot.dataUri } },
        ]),
      ],
    }),
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

/**
 * The screenshots the run's last refusal listed, fetched and recorded as
 * opened in this run. Empty when the last refusal lists none.
 * @param ctx - The run's context (org, missionRunId, agent).
 * @param toolName - The required tool whose refusal is read.
 */
async function shotsFromRefusal(ctx: RuntimeContext, toolName: string): Promise<Array<{ title: string; link: string; dataUri: string }>> {
  if (!ctx.missionRunId) {
    return [];
  }
  const { desc, sql } = await import('drizzle-orm');
  const { toolCallSchema } = await import('@/models/Schema');
  const [last] = await db
    .select({ output: toolCallSchema.output })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, ctx.orgId), eq(toolCallSchema.missionRunId, ctx.missionRunId), eq(toolCallSchema.tool, toolName), sql`${toolCallSchema.output}::text like '%Not recorded%'`))
    .orderBy(desc(toolCallSchema.id))
    .limit(1);
  const text = typeof last?.output === 'string' ? last.output : JSON.stringify(last?.output ?? '');
  const listed = listedShots(text);
  if (listed.length === 0) {
    return [];
  }
  const { artifactImageUrl } = await import('@/services/agents/tools/fetchImage');
  const { fetchImage } = await import('@/libs/tools/image/remote');
  const { persistToolCall } = await import('@/services/agents/toolCallRecord');
  const out: Array<{ title: string; link: string; dataUri: string }> = [];
  for (const { title, link } of listed) {
    const stored = await artifactImageUrl(ctx.orgId, link).catch(() => null);
    if (!stored) {
      continue;
    }
    const started = Date.now();
    const got = await fetchImage(stored, { maxEdge: 1100 }).catch(() => null);
    if (!got) {
      continue;
    }
    out.push({ title, link, dataUri: got.dataUri });
    await persistToolCall({ ctx, tool: 'fetch_image', input: { url: link, by: 'recording pass' }, output: `Image fetched and verified: ${got.contentType}, ${got.width}×${got.height}, from ${link} (opened by the recording pass)`, durationMs: Date.now() - started, ns: '' });
  }
  return out;
}

/**
 * The screenshots a refusal lists (`- <title>: <artifact page link>`), at most twelve.
 * @param text - The refusal.
 */
export function listedShots(text: string): Array<{ title: string; link: string }> {
  return [...text.matchAll(/- ([^\n]+?): (https?:\/\/\S+\/dashboard\/artifacts\/\d+)/g)].slice(0, 12).map(m => ({ title: m[1]!, link: m[2]! }));
}
