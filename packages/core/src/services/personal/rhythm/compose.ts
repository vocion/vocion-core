/**
 * The words of a morning brief or an evening wrap, from its facts
 * (docs/guides/morning-brief.md).
 *
 * Two layers. The facts are rendered in code: every meeting, every decision
 * in the order to take it, every link and date comes from a record. A small
 * model writes only what code cannot: the one line of context under each
 * meeting, read from the evidence gathered for it, and up to three suggested
 * actions. Its answer is typed (a tool call), and anything it says about a
 * meeting must name one the facts hold. When the model cannot be reached, the
 * brief still goes out, with the evidence's first line as the context and the
 * oldest decisions as the actions: a brief that arrives beats a better one
 * that does not.
 */

import type { Meeting, RhythmFacts } from './facts';
import { z } from 'zod';
import { formatDate, formatDateTime, formatTime } from '@/libs/time/zone';

/** At most this many suggested actions; the Decision card draws them, recommended first. */
export const MAX_ACTIONS = 3;

/** One suggested action, as the Decision card offers it. */
export type SuggestedAction = { label: string; why: string };

export type RhythmMessage = {
  title: string;
  markdown: string;
  actions: SuggestedAction[];
};

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
export type RhythmWriter = (orgId: string, facts: string) => Promise<WriterOutput | null>;

/**
 * The facts as the model reads them: meetings with their evidence, what waits
 * on the person, what the team did. No tokens, no ids beyond the meeting's.
 * @param f - The facts.
 */
export function factsForWriter(f: RhythmFacts): string {
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
export const modelWriter: RhythmWriter = async (orgId, facts) => {
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
    console.warn('rhythm: the brief writer could not answer; the brief goes out without its lines', { orgId, message: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
};

/**
 * The context line for a meeting with no written one: its first piece of
 * evidence, said with where it came from.
 * @param m - The meeting.
 */
function evidenceLine(m: Meeting): string {
  const e = m.evidence[0];
  return e ? `${e.text.split(' — ')[0]!.slice(0, 110)} (${e.where})` : '';
}

/**
 * Render a brief or a wrap. Pure, given the writer's answer.
 * @param f - The facts.
 * @param written - The writer's lines, or null to use the facts alone.
 */
export function renderRhythm(f: RhythmFacts, written: WriterOutput | null): RhythmMessage {
  const tz = f.timeZone;
  const day = formatDate(f.now, tz);
  const yours = f.waiting.decisions.filter(d => d.yours);
  const contextOf = new Map((written?.meetings ?? []).map(m => [m.id, m.context.trim()]));
  const out: string[] = [];

  const meetingLines = (items: Meeting[]) => items.map((m) => {
    const when = m.allDay ? 'All day' : m.start ? formatTime(m.start, tz) : '';
    const context = contextOf.get(m.id) || evidenceLine(m);
    return `- **${when} · ${m.title}**${context ? ` — ${context}` : ''}`;
  });

  if (f.kind === 'brief') {
    const meetings = f.meetings.status === 'read' ? f.meetings.items : [];
    out.push(`**Good morning${f.name ? `, ${f.name.split(' ')[0]}` : ''} — ${day}.** ${f.meetings.status === 'read' ? `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}` : 'Calendar not read'}, ${yours.length} ${yours.length === 1 ? 'decision' : 'decisions'} on you.`);
    out.push('', '## Today\'s meetings', '');
    if (f.meetings.status === 'unavailable') {
      out.push(`${f.meetings.why}`);
    } else if (meetings.length === 0) {
      out.push('Nothing on your calendar today.');
    } else {
      out.push(...meetingLines(meetings));
    }
  } else {
    out.push(`**Your wrap — ${day}.**`);
    out.push('', '## Done today', '');
    if (f.doneToday.length === 0 && f.finishedToday.length === 0) {
      out.push('Nothing decided or finished on the record today.');
    }
    for (const d of f.doneToday) {
      out.push(`- You decided [${d.title}](${d.href}) — ${d.workspace}`);
    }
    for (const r of f.finishedToday) {
      out.push(`- Finished: ${r.title} — ${r.workspace}`);
    }
  }

  out.push('', f.kind === 'brief' ? '## Waiting on you — in the order to take it' : '## Still open', '');
  if (yours.length === 0 && f.waiting.followUps.length === 0) {
    out.push('Nothing is waiting on you.');
  }
  yours.slice(0, 8).forEach((d, i) => {
    out.push(`${i + 1}. [${d.title}](${d.link}) — ${d.workspace.name} · waiting since ${formatDate(d.at, tz)}`);
  });
  if (yours.length > 8) {
    out.push(`- and ${yours.length - 8} more in Needs you`);
  }
  for (const u of f.waiting.followUps.slice(0, 3)) {
    out.push(`- Follow-up you owe: [${u.title}](${u.href}) — ${u.workspace.name}`);
  }
  if (f.waiting.unavailable.length > 0) {
    out.push(`- Could not read ${f.waiting.unavailable.map(u => u.workspace.name).join(', ')}.`);
  }

  if (f.kind === 'brief' && f.team.length > 0) {
    out.push('', `## Since you last looked (${formatDateTime(f.since, tz)})`, '');
    for (const t of f.team) {
      const parts = [
        t.decided > 0 ? `${t.decided} ${t.decided === 1 ? 'decision' : 'decisions'} taken` : '',
        ...t.runs.map(r => `finished “${r}”`),
        ...t.briefs.map(b => `[${b.title}](${b.href})`),
      ].filter(Boolean);
      out.push(`- **${t.workspace.name}** — ${parts.join(', ')}`);
    }
  }

  if (f.kind === 'wrap') {
    out.push('', '## First tomorrow', '');
    const first = f.meetings.status === 'read' ? f.meetings.items.find(m => !m.allDay) : undefined;
    if (first?.start) {
      out.push(`- **${formatTime(first.start, tz)} · ${first.title}**`);
    } else if (f.meetings.status === 'unavailable') {
      out.push(`- ${f.meetings.why}`);
    }
    if (yours[0]) {
      out.push(`- Take [${yours[0].title}](${yours[0].link}) first — it has waited longest.`);
    } else if (!first) {
      out.push('- Nothing is booked or waiting yet.');
    }
  }

  const actions: SuggestedAction[] = (written?.actions ?? []).slice(0, MAX_ACTIONS).map(a => ({ label: a.label.trim(), why: a.why.trim() })).filter(a => a.label);
  const fallback = actions.length > 0 ? actions : yours.slice(0, MAX_ACTIONS).map(d => ({ label: `Take “${d.title.slice(0, 50)}”`, why: `Waiting on you in ${d.workspace.name} since ${formatDate(d.at, tz)}.` }));
  if (fallback.length > 0) {
    out.push('', fallback.length === 1 ? 'One thing to do first is in the card below.' : `The ${fallback.length} things I would do first are in the card below.`);
  }
  return {
    title: `${f.kind === 'brief' ? 'Morning brief' : 'Evening wrap'} · ${day}`,
    markdown: out.join('\n'),
    actions: fallback,
  };
}
