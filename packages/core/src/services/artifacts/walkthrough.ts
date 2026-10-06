/**
 * THE WALKTHROUGH A SEAT SPEAKS OVER ITS RECORDING (Chris, 2026-10-03). The
 * agent that made the recording writes 5–10 short lines in plain words, each
 * timed to the moment it describes: the moments its browser session logged
 * (`spec.timeline` — each action, page and screenshot, with when it happened
 * from the recording's start) when there are any, else spread over the
 * recording's length. One model call bound to one tool whose schema is the
 * script; the seat's own name, description and voice settings are its
 * persona. A failed read returns its reason, never a guess.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { TimelineMoment } from './recordings';
import type { ScriptLine } from '@/libs/media/narration';
import { z } from 'zod';

import { SPOKEN_CHARS_PER_SECOND } from '@/libs/media/narration';

type Model = Pick<BaseChatModel, 'bindTools'>;

export { SPOKEN_CHARS_PER_SECOND };

export const WalkthroughSchema = z.object({
  lines: z.array(z.object({
    atMs: z.number().int().min(0).describe('When the line starts, in milliseconds from the start of the recording: the moment of what it describes.'),
    text: z.string().min(2).max(160).describe('One spoken sentence in plain words, first person, as the agent who did it: what is on screen and what it shows. No ids, no URLs, no markdown.'),
  })).min(3).max(10),
});

/**
 * The prompt's account of the recording: its length and, one line each, the
 * moments it shows.
 * @param input - The recording.
 * @param input.caption - Its caption.
 * @param input.durationMs - Its length.
 * @param input.timeline - What it shows, when.
 * @param input.context - What the work was (the request's title and done-when lines), when known.
 */
export function describeRecording(input: { caption: string; durationMs: number | null; timeline: readonly TimelineMoment[]; context?: string | null }): string {
  const secs = input.durationMs ? Math.round(input.durationMs / 1000) : null;
  const budget = secs ? Math.max(60, Math.floor(secs * SPOKEN_CHARS_PER_SECOND * 0.8)) : 400;
  return [
    `The recording: ${input.caption}.`,
    secs ? `It is ${secs} seconds long. Everything you say must fit inside it: at most ${budget} characters across all lines, and the last line must start before ${Math.max(0, secs - 2)} seconds.` : `Keep it under ${budget} characters across all lines.`,
    input.context ? `What the work was:\n${input.context.slice(0, 2_000)}` : '',
    input.timeline.length > 0
      ? `What happened on screen, with when (ms from the start):\n${input.timeline.slice(0, 80).map(m => `- ${m.atMs} ms: ${m.what}${m.ok === false ? ' (failed)' : ''}${m.detail ? ` — ${m.detail.slice(0, 160)}` : ''}${m.url ? ` [${m.url.slice(0, 120)}]` : ''}`).join('\n')}`
      : 'Nothing was logged about what happened when: spread the lines evenly across the recording, describing what a viewer would be shown.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The walkthrough, or why there is none.
 * @param input - Who speaks and over what.
 * @param input.orgId - The workspace.
 * @param input.speaker - The seat: its name, what it does, and its voice settings in words when it has them.
 * @param input.speaker.name - The agent's name.
 * @param input.speaker.slug - The agent's slug (budget scope).
 * @param input.speaker.description - What it does.
 * @param input.recording - What it recorded.
 * @param input.recording.caption - The caption.
 * @param input.recording.durationMs - Its length, when known.
 * @param input.recording.timeline - What it shows, when.
 * @param input.recording.context - What the work was.
 * @param model - Injected in tests.
 */
export async function writeWalkthrough(input: {
  orgId: string;
  speaker: { name: string; slug?: string; description?: string | null };
  recording: { caption: string; durationMs: number | null; timeline: readonly TimelineMoment[]; context?: string | null };
}, model?: Model): Promise<{ ok: true; lines: ScriptLine[] } | { ok: false; reason: string }> {
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      // The extractor seat: the walkthrough is one forced tool call, and the main seat's model
      // (Sonnet 5.5) always thinks, which refuses a forced tool_choice with a 400 (2026-10-05: every
      // live-check narration since #1167 failed with it).
      return buildChatModelForOrg('extractor', input.orgId, { temperature: 0.3, streaming: false, maxTokens: 1_500, thinking: 'off' }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'record_walkthrough', description: 'Record the spoken walkthrough of the recording.', schema: WalkthroughSchema as never });
    const system = [
      `You are ${input.speaker.name}${input.speaker.description ? `: ${input.speaker.description.replace(/\s+/g, ' ').slice(0, 400)}` : ''}.`,
      'You recorded a screen recording of your own work, and you now narrate it for the person who owns the outcome: 5 to 10 short spoken lines, first person, plain words, each starting at the moment it describes.',
      'Say what a viewer is looking at and what it proves — the page, the action, the result — not how the tooling works. Name a failure plainly when the recording shows one. No ids, no URLs, no markdown. Answer only through the tool.',
    ].join(' ');
    const res = await m.bindTools!([report], { tool_choice: 'record_walkthrough' } as never).invoke([
      new SystemMessage(system),
      new HumanMessage(describeRecording(input.recording)),
    ]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (!model) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: input.orgId, agentSlug: input.speaker.slug, feature: FEATURES.RECORDING_WALKTHROUGH, role: 'extractor', response: res as never }).catch(() => undefined);
    }
    const call = (res.tool_calls ?? []).find(c => c.name === 'record_walkthrough');
    const parsed = call ? WalkthroughSchema.safeParse(call.args) : null;
    if (!parsed?.success) {
      return { ok: false, reason: 'the walkthrough came back without a script that could be read.' };
    }
    return { ok: true, lines: parsed.data.lines.map(l => ({ atMs: l.atMs, text: l.text.trim() })) };
  } catch (err) {
    return { ok: false, reason: `the walkthrough could not be written (${(err as Error)?.message?.slice(0, 160) ?? 'unknown error'}).` };
  }
}
