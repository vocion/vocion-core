/**
 * WHO SHOULD ANSWER, READ BY A MODEL — the first turn's routing, as typed
 * fields (Chris, 2026-09-29: meaning is read by a model, never matched).
 *
 * Conversation 397 (2026-09-30): a person wrote "On the document page, add a
 * line under the title that says when it was last opened and by whom …
 * Please file it and build it." The keyword router scored "document", "plan"
 * and "decision" against each agent's handles and sent it to the wiki
 * researcher, a seat with no factory tools, which spent five minutes and 38
 * tool calls improvising before asking the person to approve what they had
 * already asked for. The question — which seat owns this work — is a
 * question about meaning, so it is asked of the classifier once: the message,
 * and the roster with what each seat owns (the record types it answers for
 * and files, its granted tools and skills). The model answers through one
 * tool whose schema is the typed answer, and `routeFirstTurn` in `router.ts`
 * routes on the fields.
 *
 * This module only reads. It throws when the read fails or comes back out of
 * shape, so the caller can record why it fell back.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RoutableAgent } from './router';
import { z } from 'zod';

export const RouteReadSchema = z.object({
  chosen: z.string().max(80).describe('The slug of the one agent that should answer, exactly as the roster writes it.'),
  confidence: z.number().min(0).max(1).describe('How sure you are, 0 to 1: near 1 when the message plainly asks for work this agent owns; below 0.5 when you are guessing.'),
  reason: z.string().max(300).describe('One sentence a person can check against the roster: what the person wants, and why this agent owns it.'),
});
export type RouteRead = z.infer<typeof RouteReadSchema>;

type Model = Pick<BaseChatModel, 'bindTools'>;

const SYSTEM = [
  'You choose which agent on a work app\'s roster answers the first message of a new conversation.',
  'Judge what the person wants done, then which agent owns that work: the record types it answers for or files, its tools and skills, then its description and what it handles.',
  'A request to file, build, change or ship something goes to the agent that owns that kind of record, not to one whose description shares a word with the message.',
  'When nothing on the roster clearly fits, choose the workspace lead with a low confidence.',
  'Answer only through the tool.',
].join(' ');

function list(values: ReadonlyArray<string> | null | undefined, max = 12): string {
  return (values ?? []).filter(Boolean).slice(0, max).join(', ');
}

/**
 * One seat as the model reads it: who it is, what it does, what it owns.
 * @param agent - The seat.
 * @param leadSlug - The workspace lead, marked.
 */
export function seatLines(agent: RoutableAgent, leadSlug: string | null): string {
  return [
    `- ${agent.slug} (${agent.name})${agent.slug === leadSlug ? ' — the workspace lead' : ''}`,
    agent.description ? `  does: ${agent.description.replace(/\s+/g, ' ').trim().slice(0, 500)}` : '',
    list(agent.handles) ? `  handles: ${list(agent.handles)}` : '',
    list(agent.owns) ? `  answers for these record types: ${list(agent.owns)}` : '',
    list(agent.objectTypes) ? `  reads and files records of type: ${list(agent.objectTypes)}` : '',
    list(agent.tools) ? `  granted tools: ${list(agent.tools)}` : '',
    list(agent.skills) ? `  skills: ${list(agent.skills)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * The classifier, built the way every typed read in core builds it.
 * @param orgId - The workspace, for its model settings.
 */
async function classifier(orgId: string): Promise<Model> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  return buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as Promise<Model>;
}

/**
 * Which agent on the roster should answer this message. Throws when the read
 * fails or its answer is out of shape; the slug is NOT checked against the
 * roster here — the caller does that, and records it when it is not.
 * @param input - The read.
 * @param input.orgId - The workspace.
 * @param input.message - The person's first message.
 * @param input.agents - The active roster, with what each seat owns.
 * @param input.leadSlug - The workspace lead.
 * @param input.signal - Aborts the call when the caller stops waiting.
 * @param model - Injected in tests.
 */
export async function readRoute(input: { orgId: string; message: string; agents: RoutableAgent[]; leadSlug: string | null; signal?: AbortSignal }, model?: Model): Promise<RouteRead> {
  const { tool } = await import('@langchain/core/tools');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const m = model ?? await classifier(input.orgId);
  const report = tool(async () => 'recorded', { name: 'report_route', description: 'Report which agent should answer the message.', schema: RouteReadSchema as never });
  const bound = m.bindTools!([report], { tool_choice: 'report_route' } as never);
  const res = await bound.invoke([
    new SystemMessage(SYSTEM),
    new HumanMessage([
      `The roster:\n${input.agents.map(a => seatLines(a, input.leadSlug)).join('\n')}`,
      `The person's message:\n${input.message.slice(0, 4_000)}`,
    ].join('\n\n')),
  ], { signal: input.signal } as never) as { tool_calls?: Array<{ name: string; args: unknown }> };
  if (!model) {
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    void chargeModelCall({ orgId: input.orgId, feature: FEATURES.CHAT_ROUTE, role: 'classifier', response: res }).catch(() => {});
  }
  const call = (res.tool_calls ?? []).find(c => c.name === 'report_route');
  if (!call) {
    throw new Error('the model answered without the report tool');
  }
  const parsed = RouteReadSchema.safeParse(call.args);
  if (!parsed.success) {
    throw new Error(`the model's answer was out of shape: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
