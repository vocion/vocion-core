/**
 * AN AGENT'S VOICE — how it talks in chat, set by the workspace, never by
 * editing its replies afterwards (Chris, 2026-09-29: "we should be able to
 * control and steer how it talks, how verbose it is, how creative it is").
 *
 * Authored on the agent (`voice:` in agents/<slug>.yaml), changed from the
 * agent's page, over MCP, the API or in chat (an override the next apply
 * keeps), and composed into the agent's prompt at compile time — the one
 * place core speaks to the model about voice. `creativity` also sets the
 * sampling temperature on a model that accepts one; Claude 4.7+ and the 5
 * family refuse sampling parameters (`anthropicOmitsSampling`), and there the
 * prompt carries it alone.
 *
 * Pure: no database, no React.
 */
import { z } from 'zod';

export const VOICE_LENGTHS = ['brief', 'standard', 'detailed'] as const;
export const VOICE_NARRATION = ['off', 'on'] as const;

export const VoiceSchema = z.object({
  /** How long a chat reply runs. */
  length: z.enum(VOICE_LENGTHS).optional(),
  /** Whether it says what it is about to do before doing it. */
  narration: z.enum(VOICE_NARRATION).optional(),
  /** 0 sticks to what the records say; 1 offers ideas beyond them. */
  creativity: z.number().min(0).max(1).optional(),
  /** A wiki page, in prose, on how this workspace talks. */
  style: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
}).strict();

export type Voice = z.infer<typeof VoiceSchema>;
export type ResolvedVoice = Required<Omit<Voice, 'style'>> & Pick<Voice, 'style'>;

/** What an agent sounds like when nothing is set: today's platform voice. */
export const DEFAULT_VOICE: ResolvedVoice = { length: 'standard', narration: 'on', creativity: 0.3 };

/**
 * The voice an agent runs with: the default, then its YAML, then an override
 * set from the page, MCP, the API or chat.
 * @param layers - Later layers win, key by key.
 */
export function resolveVoice(...layers: Array<Voice | null | undefined>): ResolvedVoice {
  const out: ResolvedVoice = { ...DEFAULT_VOICE };
  for (const layer of layers) {
    const parsed = VoiceSchema.safeParse(layer ?? {});
    if (!parsed.success) {
      continue;
    }
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

const LENGTH: Record<ResolvedVoice['length'], string> = {
  brief: 'Length: brief. Lead with the answer or the move in the first sentence. The whole reply fits a phone screen, about 120 words at most, unless the person asks for more; detail belongs in the card, the record or a follow-up.',
  standard: 'Length: standard. Lead with the answer; one screen at most.',
  detailed: 'Length: detailed. Lead with the answer, then give the reasoning and the evidence in full.',
};

const NARRATION: Record<ResolvedVoice['narration'], string> = {
  off: 'Narration: off. Do not say what you are about to do, are doing, or are about to show ("Let me check…", "Before I…", "Here\'s the card:"). Make the calls: the person sees your steps on the trace and your cards under the reply. Say what you found, what you did, and what is next for them.',
  on: 'Narration: on. One short line before a long step is fine; never narrate a step you have already shown.',
};

function creativityLine(c: number): string {
  if (c <= 0.3) {
    return 'Creativity: conservative. Stay with what the records, the wiki and the conversation support; propose nothing they do not.';
  }
  if (c < 0.7) {
    return 'Creativity: balanced. Stay with the evidence, and offer one alternative when it clearly helps.';
  }
  return 'Creativity: inventive. Offer options and ideas beyond the obvious, and mark them as ideas, not findings.';
}

/**
 * The voice section of the agent's prompt.
 * @param voice - The resolved voice.
 * @param style - The style page, when the voice names one and it was found.
 * @param style.slug - The page's slug.
 * @param style.content - Its markdown.
 */
export function voicePrompt(voice: ResolvedVoice, style?: { slug: string; content: string } | null): string {
  return [
    'VOICE (chat replies): write like a sharp human chief of staff texting a busy founder, not a chatbot. No decorative or stoplight emoji as bullets or status markers, no templated scaffolding ("I hope this helps", "Let me know if…"), no filler closers. Keep a short ranked list tight (a bold lead-in and one line each), with no per-item headers or rules. Lead with the move, be specific, cut hedging. A published, scannable document (a briefing, an explicitly long report) may use section structure; the rules here are for conversation.',
    LENGTH[voice.length],
    NARRATION[voice.narration],
    creativityLine(voice.creativity),
    ...(style?.content.trim() ? [`How this workspace talks (wiki page ${style.slug}):\n${style.content.trim().slice(0, 4_000)}`] : []),
  ].join('\n');
}

/**
 * The sampling temperature the voice asks for, or undefined when the model
 * refuses sampling parameters.
 * @param voice - The resolved voice.
 * @param omitsSampling - Whether the model refuses them (`anthropicOmitsSampling`).
 */
export function voiceTemperature(voice: ResolvedVoice, omitsSampling: boolean): number | undefined {
  return omitsSampling ? undefined : voice.creativity;
}
