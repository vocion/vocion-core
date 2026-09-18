/**
 * Self-reflection on a correction — structural, not a prompt.
 *
 * 2026-09-18: the agent said "no Zoom recording exists for the Sept 16 call";
 * Chris pasted the recording link; the transcript was there. The turn that
 * followed fixed the room and moved on. Chris: "Vocion should have had self
 * reflection to see how it was corrected, and identified ability for self
 * improvement." Nothing in the loop noticed the shape of what happened: an
 * absence claim followed by the person supplying the thing.
 *
 * This module notices it. `detectCorrection` is pure: the previous assistant
 * turn asserted that something could not be found or did not exist, and the
 * person's next message hands it over (a link, "here's…", an attachment).
 * `reflectOnCorrection` then drafts one rule with the cheap model and files
 * it as a learning candidate (polarity `correct`) — visible on the Learnings
 * page, adopted by a person, never silently — and the turn's envelope tells
 * the agent to acknowledge the correction and say what it will do differently.
 * The feedback loop already exists for review decisions and thumbs; this is
 * the same loop fed by the conversation itself.
 */

import { recordProposedRule } from '@/services/feedback/ruleRecorder';

const ABSENCE = /\b(?:no|not|never|couldn'?t|could not|cannot|can'?t|unable to|isn'?t|doesn'?t|didn'?t|wasn'?t|failed to)\b[^.\n]{1,90}?\b(?:exist|exists|find|found|indexed|available|recorded|recording|came back empty|returned nothing|lookup|located|locate|see it|have it)\b/i;
const SUPPLIED = /https?:\/\/\S+|\b(?:here(?:'s| is| are)|this is (?:the|it)|attached|attaching|pasting|pasted|i(?:'ve| have) attached|see attached|found it)\b/i;

export type Correction = {
  /** The sentence in which the agent said the thing was not there. */
  claim: string;
  /** What the person supplied, trimmed for the note. */
  supplied: string;
};

/**
 * Whether the person's message corrects an absence the agent asserted last turn.
 * @param previousAssistant - The agent's last turn, as text.
 * @param userMessage - The person's new message.
 */
export function detectCorrection(previousAssistant: string | undefined, userMessage: string): Correction | null {
  if (!previousAssistant || !userMessage.trim()) {
    return null;
  }
  const sentences = previousAssistant.split(/(?<=[.!?])\s+|\n+/);
  const claim = sentences.find(s => ABSENCE.test(s));
  if (!claim || !SUPPLIED.test(userMessage)) {
    return null;
  }
  return { claim: claim.trim().slice(0, 240), supplied: userMessage.trim().replace(/\s+/g, ' ').slice(0, 240) };
}

/**
 * The line added under the person's message so the agent owns the correction
 * in its reply instead of quietly proceeding.
 * @param c
 */
export function correctionNote(c: Correction): string {
  return `--- correction ---\nLast turn you said: "${c.claim}" The person has just supplied it. Acknowledge that in one sentence, use what they gave you, and say in one sentence what you will do differently next time (which tool or lookup you should have tried). A learning candidate has been filed for a person to review; do not file another.`;
}

/**
 * Draft one rule from the correction with the cheap model and file it as a
 * learning candidate. Fire-and-forget from the stream route: a failure here
 * must never cost the person their turn.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.userId
 * @param opts.correction
 * @param opts.draft - Injectable model call for tests; defaults to the classifier model.
 */
export async function reflectOnCorrection(opts: {
  orgId: string;
  agentSlug?: string;
  userId?: string;
  correction: Correction;
  draft?: (c: Correction) => Promise<{ rule: string; gap: string } | null>;
}): Promise<{ filed: boolean; reason?: string }> {
  const drafted = await (opts.draft ?? draftWithModel(opts.orgId))(opts.correction);
  if (!drafted?.rule) {
    return { filed: false, reason: 'no rule drafted' };
  }
  const res = await recordProposedRule({
    orgId: opts.orgId,
    ruleText: drafted.rule,
    polarity: 'correct',
    memoryType: 'procedure',
    agentSlug: opts.agentSlug ?? null,
    submittedBy: opts.userId ?? null,
    note: `Chat correction. The agent said: "${opts.correction.claim}" The person then supplied: "${opts.correction.supplied}". Tooling gap: ${drafted.gap || 'none named'}.`,
  });
  return { filed: res.outcome !== 'skipped', reason: res.outcome === 'skipped' ? res.reason : undefined };
}

function draftWithModel(orgId: string): (c: Correction) => Promise<{ rule: string; gap: string } | null> {
  return async (c) => {
    const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 300, streaming: false });
    const res = await model.invoke([
      { role: 'system', content: 'An AI agent told a person something could not be found; the person then supplied it. Write ONE operating rule (imperative, under 40 words) that would have avoided the miss, and name the tooling gap in under 25 words. Return STRICT JSON: {"rule":"…","gap":"…"}.' },
      { role: 'user', content: `Agent said: ${c.claim}\nPerson replied: ${c.supplied}` },
    ]);
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    try {
      const parsed = JSON.parse(text.slice(a, b + 1)) as { rule?: unknown; gap?: unknown };
      return typeof parsed.rule === 'string' ? { rule: parsed.rule.trim(), gap: typeof parsed.gap === 'string' ? parsed.gap.trim() : '' } : null;
    } catch {
      return null;
    }
  };
}
