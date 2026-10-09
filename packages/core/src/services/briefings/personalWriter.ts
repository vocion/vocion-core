/**
 * The one model call a personal brief makes (docs/guides/morning-brief.md).
 *
 * The composer (`personal.ts`) renders every fact in code: every meeting,
 * every decision in the order to take it, every link and date comes from a
 * record. This small model writes only what code cannot: the one line of
 * context under each meeting, read from the evidence gathered for it, and up
 * to three suggested actions. Its answer is typed (a tool call), and anything
 * it says about a meeting must name one the facts hold. When the model cannot
 * be reached, or the brief budget says no (`budgetGate.ts`), the brief still
 * goes out with the evidence's first line as the context and the oldest
 * decisions as the actions: a brief that arrives beats a better one that does
 * not.
 */

import type { PersonalFacts } from './personalFacts';
import { z } from 'zod';
import { formatDateTime, formatTime } from '@/libs/time/zone';

/** At most this many suggested actions; pills under the delivered brief draw them (`libs/chat/suggestions.ts`). */
export const MAX_ACTIONS = 3;

/** One suggested action, as a pill offers it: its words are the person's next ask. */
export type SuggestedAction = { label: string; why: string };

const WriterSchema = z.object({
  meetings: z.array(z.object({
    id: z.string().describe('The meeting id, exactly as given.'),
    context: z.string().max(160).describe('One line: what this meeting is about or what to have ready, from the evidence only. Empty when the evidence says nothing useful.'),
  })).max(20),
  actions: z.array(z.object({
    label: z.string().max(70).describe('An imperative the assistant can do or prepare when chosen, e.g. "Draft the reply to Dana about renewal terms".'),
    why: z.string().max(140).describe('Why now, in one line, naming the fact it comes from.'),
  })).max(MAX_ACTIONS),
});
export type WriterOutput = z.infer<typeof WriterSchema>;

/** The model seam: given the facts as text, the typed lines; null when it could not answer. */
export type BriefWriter = (orgId: string, facts: string) => Promise<WriterOutput | null>;

/**
 * The facts as the model reads them: meetings with their evidence, what waits
 * on the person, what the team did. No tokens, no ids beyond the meeting's.
 * @param f - The facts.
 */
export function factsForWriter(f: PersonalFacts): string {
  const out: string[] = [`It is ${formatDateTime(f.now, f.timeZone)}. This is ${f.name ?? 'the person'}'s ${f.kind === 'brief' ? 'morning brief' : 'evening wrap'}.`];
  if (f.meetings.status === 'read') {
    out.push('', f.kind === 'brief' ? 'MEETINGS TODAY:' : 'MEETINGS TOMORROW:');
    for (const m of f.meetings.items) {
      out.push(`- id=${m.id} · ${m.allDay ? 'all day' : m.start ? formatTime(m.start, f.timeZone) : ''} · ${m.title} · with ${m.attendees.slice(0, 6).join(', ') || 'nobody listed'}`);
      for (const e of m.evidence) {
        out.push(`  evidence (${e.where}): ${e.text.replace(/\s+/g, ' ')}`);
      }
    }
  }
  const yours = f.waiting.decisions.filter(d => d.yours);
  out.push('', 'WAITING ON THEM, in order:');
  for (const d of yours.slice(0, 8)) {
    out.push(`- ${d.title} (${d.workspace.name}, ${d.kind})`);
  }
  for (const u of f.waiting.followUps.slice(0, 3)) {
    out.push(`- follow-up owed: ${u.title}`);
  }
  // Saved views the person reads every day (`services/state/views.ts`):
  // the email replies they owe, and any view they put in their brief.
  for (const v of f.waiting.views ?? []) {
    if (v.total === 0) {
      continue;
    }
    out.push('', `${v.name.toUpperCase()} (${v.total}):`);
    for (const r of v.rows.slice(0, 5)) {
      out.push(`- ${r.title}${typeof r.facets.ask === 'string' && r.facets.ask ? ` — ${r.facets.ask}` : ''}`);
    }
  }
  if (f.team.length > 0) {
    out.push('', 'THE TEAM SINCE THEY LAST LOOKED:');
    for (const t of f.team) {
      out.push(`- ${t.workspace.name}: ${t.decided} decided; finished ${t.runs.join('; ') || 'nothing'}`);
    }
  }
  return out.join('\n');
}

/**
 * The default writer: the classifier model, answering through one tool so the
 * answer is typed. Charged to the person's Personal workspace like every paid call.
 * @param orgId - The Personal workspace.
 * @param facts - The facts, as text.
 */
export const modelWriter: BriefWriter = async (orgId, facts) => {
  try {
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0.2, streaming: false, maxTokens: 900 });
    const report = tool(async () => 'recorded', { name: 'write_brief', description: 'Write the meeting context lines and suggested actions.', schema: WriterSchema as never });
    const bound = model.bindTools!([report], { tool_choice: 'write_brief' } as never);
    const res = await bound.invoke([
      new SystemMessage('You are a chief of staff writing one person\'s daily brief. Use ONLY the facts given. For each meeting, one line of context from its evidence: what it is about, or what to have ready; leave it empty when the evidence says nothing. Then at most three actions to take first, most important first — concrete things their assistant can do or prepare when chosen (draft a reply, prepare notes, take a decision), each with why, naming the fact. Never invent a person, a date or a number. Answer only through the tool.'),
      new HumanMessage(facts),
    ]);
    await chargeModelCall({ orgId, feature: 'personal.brief', role: 'classifier', response: res });
    const call = ((res as { tool_calls?: Array<{ name: string; args: unknown }> }).tool_calls ?? []).find(c => c.name === 'write_brief');
    const parsed = call ? WriterSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (error) {
    console.warn('personal brief: the writer could not answer; the brief goes out without its lines', { orgId, message: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
};
