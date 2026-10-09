/**
 * A brief, said out loud (docs/guides/listen-to-your-brief.md).
 *
 * Not a reading: a person telling you your day. A cheap model (the
 * classifier role) rewrites the brief as a spoken script — conversational,
 * the important things first, about one to two and a half minutes — with no
 * markdown, links, tables or ids, and people and numbers said the way a
 * person says them ("three decisions", "about twelve thousand dollars").
 *
 * The rules are a requirement, so they are held structurally rather than by
 * prompt wording alone (CLAUDE.md, "Structural over prompting"):
 *
 *   1. the model answers through one tool, so the script is a typed field;
 *   2. {@link scriptProblems} checks the answer — too long, a link, markdown,
 *      an id — and only when one is found, the model is asked once more,
 *      told exactly which;
 *   3. still wrong, the script is made speakable mechanically and cut at a
 *      sentence inside the bound ({@link speakable}, {@link trimToSeconds}),
 *      because the alternative is reading a URL aloud to someone driving.
 *
 * With no model (the budget said no, or it could not answer), the brief's
 * own words are made speakable the same way: audio that arrives beats better
 * audio that does not. A thin brief makes a short script; 60 seconds is what
 * a full day sounds like, never padding (`docs/design/reduction.md`).
 */

import type { FeatureName } from '@/libs/Langfuse/features';
import { z } from 'zod';

/** How long a script runs, and the pace it is measured at. */
export const SCRIPT_BOUNDS = {
  /** What a full day sounds like. A thin brief is shorter, never padded. */
  minSeconds: 60,
  /** The ceiling: past this it is a podcast, and too large to text. */
  maxSeconds: 150,
  /** A relaxed conversational pace; ElevenLabs narrators run about this. */
  wordsPerMinute: 155,
} as const;

/** The most words a script may have: {@link SCRIPT_BOUNDS} at its pace. */
export const MAX_SCRIPT_WORDS = Math.floor(SCRIPT_BOUNDS.maxSeconds / 60 * SCRIPT_BOUNDS.wordsPerMinute);
/** The words a full day's script aims for at least. */
export const MIN_SCRIPT_WORDS = Math.ceil(SCRIPT_BOUNDS.minSeconds / 60 * SCRIPT_BOUNDS.wordsPerMinute);

/**
 * The words of a text.
 * @param text - The text.
 */
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * How long a script takes to say, in seconds, at {@link SCRIPT_BOUNDS}' pace.
 * @param text - The script.
 */
export function scriptSeconds(text: string): number {
  return words(text).length / SCRIPT_BOUNDS.wordsPerMinute * 60;
}

/** A way a script breaks the rules, as the retry names it. */
export type ScriptProblem = 'too_long' | 'link' | 'markdown' | 'id' | 'empty';

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\/(?:dashboard|w|api)\/\S*|\b[\w-]+\.(?:com|io|ai|org|net|app|dev|co|example)(?:\/\S*)?\b/gi;
const MARKDOWN = /\[[^\]]*\]\([^)]*\)|\*\*|__|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>|\|/m;
/** A uuid, a `#123` reference, an `id=` pair, or a token mixing letters and digits that no one would say. */
const ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|(?:^|\s)#\d+\b|\bid[=:]\s*\S+|\b(?=[\w-]*\d)(?=[\w-]*[a-z])[\dA-Z]*[-_][-A-Z_]*\d[-\w]*\b|\b(?=\w*\d)(?=\w*[a-z])\w{10,}\b/i;

/**
 * Every rule a script breaks. Empty when it may be spoken as it is.
 * @param text - The script.
 */
export function scriptProblems(text: string): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  if (!text.trim()) {
    return ['empty'];
  }
  if (scriptSeconds(text) > SCRIPT_BOUNDS.maxSeconds) {
    out.push('too_long');
  }
  if (new RegExp(LINK.source, 'i').test(text)) {
    out.push('link');
  }
  if (MARKDOWN.test(text)) {
    out.push('markdown');
  }
  if (ID.test(text)) {
    out.push('id');
  }
  return out;
}

/**
 * Text made safe to say: markdown taken out (a link keeps its words), links,
 * ids and table rules dropped, lines joined into sentences. The last resort,
 * for an answer that still broke the rules, and for a brief with no model.
 * @param text - Markdown or a script.
 */
export function speakable(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(LINK, '')
    .replace(/^(?:\s*\|)?[\s:-]*\|[\s|:-]*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_`>]+/g, '')
    .replace(/^#{1,6}[ \t]*(\S.*)$/gm, '$1.')
    .replace(/^\s*(?:[-+•]|\d+\.)\s+/gm, '')
    .replace(new RegExp(ID.source, 'gi'), ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => (/[.!?:;,]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .trim();
}

/**
 * The script cut to the bound at the last whole sentence that fits.
 * @param text - The script.
 * @param maxSeconds - The bound.
 */
export function trimToSeconds(text: string, maxSeconds: number = SCRIPT_BOUNDS.maxSeconds): string {
  const max = Math.floor(maxSeconds / 60 * SCRIPT_BOUNDS.wordsPerMinute);
  const all = words(text);
  if (all.length <= max) {
    return text.trim();
  }
  const head = all.slice(0, max).join(' ');
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  return end > head.length / 2 ? head.slice(0, end + 1) : `${head.replace(/[,;:]?$/, '')}.`;
}

/** What the script is written from. */
export type ScriptSource = {
  /** The brief's title, `Your day — Fri, Oct 9`. */
  title: string;
  /** The brief's words, markdown. */
  markdown: string;
  /** Who is listening, for "Good morning, Alex"; null for a workspace's brief. */
  listener: string | null;
  /** A personal morning brief, evening wrap, or a workspace's brief. */
  kind: 'brief' | 'wrap' | 'workspace';
};

/** The model seam: system and user words in, the typed script out; null when it could not answer. */
export type ScriptModel = (orgId: string, system: string, user: string, feature: FeatureName) => Promise<string | null>;

const ScriptSchema = z.object({
  script: z.string().max(4_000).describe('The whole script, as it will be spoken: plain sentences, nothing else.'),
});

/** What the model is told. */
export function scriptInstructions(): string {
  return [
    'You turn a written brief into a short spoken script that a natural, human voice will read to one person — often in the car or on a walk.',
    `Length: about ${SCRIPT_BOUNDS.minSeconds} to ${SCRIPT_BOUNDS.maxSeconds} seconds out loud (${MIN_SCRIPT_WORDS}–${MAX_SCRIPT_WORDS} words) for a full brief; shorter when there is little to say. Never pad.`,
    'Talk like a sharp chief of staff: warm, direct, conversational. Lead with what matters most and what needs them first, then the rest. Do not read it word for word, and do not list everything: choose.',
    'Say people by name the way a colleague would ("Dana at Northwind"), and numbers the way a person says them ("three decisions", "about twelve thousand dollars", "nine thirty").',
    'Plain sentences only. No markdown, no bullet points, no headings, no tables, no links or web addresses, no ids, codes or reference numbers. If something is only a link, say what it is instead.',
    'Use only the facts in the brief. Never invent a person, date or number. End with one short line, not a sign-off speech.',
    'Answer only through the tool.',
  ].join('\n');
}

/**
 * The brief as the model reads it: links reduced to their words, so a URL is
 * never in front of it to repeat.
 * @param s - The source.
 */
export function scriptPrompt(s: ScriptSource): string {
  const who = s.listener ? `It is for ${s.listener}.` : 'It is a workspace brief, for anyone on the team.';
  const what = s.kind === 'wrap' ? 'their evening wrap' : s.kind === 'brief' ? 'their morning brief' : 'a team brief';
  const body = s.markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(LINK, '');
  return `This is ${what}, titled "${s.title}". ${who}\n\n${body}`;
}

/**
 * The default model: the classifier, answering through one tool, charged to
 * the workspace under `feature` like every paid call.
 * @param orgId - The workspace that pays.
 * @param system - The instructions.
 * @param user - The brief.
 * @param feature - The budget scope.
 */
export const modelScript: ScriptModel = async (orgId, system, user, feature) => {
  try {
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0.5, streaming: false, maxTokens: 1_200 });
    const say = tool(async () => 'recorded', { name: 'write_script', description: 'Write the spoken script.', schema: ScriptSchema as never });
    const bound = model.bindTools!([say], { tool_choice: 'write_script' } as never);
    const res = await bound.invoke([new SystemMessage(system), new HumanMessage(user)]);
    await chargeModelCall({ orgId, feature, role: 'classifier', response: res });
    const call = ((res as { tool_calls?: Array<{ name: string; args: unknown }> }).tool_calls ?? []).find(c => c.name === 'write_script');
    const parsed = call ? ScriptSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data.script.trim() : null;
  } catch (error) {
    console.warn('brief audio: the script writer could not answer; the brief is spoken from its own words', { orgId, message: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
};

const PROBLEM_WORDS: Record<ScriptProblem, string> = {
  too_long: `it is too long: keep it under ${MAX_SCRIPT_WORDS} words`,
  link: 'it contains a link or web address: say what it is instead',
  markdown: 'it contains formatting (markdown, bullets, headings or a table): plain sentences only',
  id: 'it contains an id or code no one would say: leave it out',
  empty: 'it is empty',
};

/** What a script came to, and how. */
export type SpokenScript = { text: string; by: 'model' | 'model-retry' | 'cleaned' | 'brief' };

/**
 * Write the spoken script for a brief. Never throws.
 * @param orgId - The workspace that pays for the model call.
 * @param source - The brief.
 * @param opts - The model (null: no model, the brief's own words) and the budget scope.
 * @param opts.model - The model seam.
 * @param opts.feature - The budget scope.
 */
export async function writeSpokenScript(orgId: string, source: ScriptSource, opts: { model?: ScriptModel | null; feature: FeatureName }): Promise<SpokenScript> {
  const model = opts.model === undefined ? modelScript : opts.model;
  if (model) {
    const system = scriptInstructions();
    const user = scriptPrompt(source);
    const first = await model(orgId, system, user, opts.feature);
    if (first !== null) {
      const problems = scriptProblems(first);
      if (problems.length === 0) {
        return { text: first, by: 'model' };
      }
      // A gated second pass, only on a violation, naming it.
      const again = await model(orgId, system, `${user}\n\nYour last script broke the rules — ${problems.map(p => PROBLEM_WORDS[p]).join('; ')}. Here it is; fix it:\n\n${first}`, opts.feature);
      if (again !== null && scriptProblems(again).length === 0) {
        return { text: again, by: 'model-retry' };
      }
      const cleaned = trimToSeconds(speakable(again ?? first));
      if (cleaned) {
        return { text: cleaned, by: 'cleaned' };
      }
    }
  }
  const intro = source.listener ? `${source.title}, for ${source.listener}.` : `${source.title}.`;
  return { text: trimToSeconds(speakable(`${intro}\n${source.markdown}`)), by: 'brief' };
}
