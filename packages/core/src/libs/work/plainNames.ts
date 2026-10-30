/**
 * PLAIN NAMES FOR WORK (product owner, 2026-10-29: '"keep moving" and
 * "continue" are bad mission and automation names. they are buzzy/coloquial.
 * they don't tell me what is actually being done in plain language').
 *
 * A mission, automation, workflow, team or agent is named by what is done, to
 * what: "Draft the release announcement", "Research, brief, draft and review
 * released SEO pages". Not by its slug ("seo-continue", "Seo continue"), and
 * not by a word that only says something is happening ("continue", "keep
 * moving", "sweep", "nudge", "pulse").
 *
 * The list is short on purpose: each entry is a word that never names the
 * work in a definition's name, so it can fail the build without false alarms.
 * Prose (a description, a prompt) is not held to it.
 */

import { isSlugName, isTitledSlug } from './runLabel';

/** Words that say work is happening without saying what it is. Matched case-insensitively, on word boundaries. */
export const VAGUE_NAME_WORDS: ReadonlyArray<{ pattern: RegExp; say: string }> = [
  { pattern: /\bkeeps? (?:\w+ )?moving\b/i, say: '"keep moving" — say what is done: "research and brief the approved pages"' },
  { pattern: /\bcontinu(?:e|es|ed|ing)\b/i, say: '"continue" — say what is done next, to what' },
  { pattern: /\bcarr(?:y|ies|ied|ying) (?:\w+ ){0,3}on\b/i, say: '"carry on" — say what is done: "restart", "build", "reply"' },
  { pattern: /\bsweeps?\b/i, say: '"sweep" — say what is checked or done, to what' },
  { pattern: /\bnudg(?:e|es|ed|ing)\b/i, say: '"nudge" — say what is sent, to whom' },
  { pattern: /\bticks?\b/i, say: '"tick" — say what is checked' },
  { pattern: /\bpulse\b/i, say: '"pulse" — say what is measured or reported' },
  { pattern: /\bheartbeats?\b/i, say: '"heartbeat" — say what is checked' },
  { pattern: /\bstays? on top of\b/i, say: '"stay on top of" — say what is done, to what' },
  { pattern: /\bhumming\b/i, say: '"humming" — say what is done, to what' },
  { pattern: /\bwhat moved\b/i, say: '"what moved" — say what was done' },
];

/**
 * What is wrong with a definition's name, or null when it is plain.
 * @param name - The name (or an automation's `label` / `doing`).
 * @param slug - The definition's slug.
 */
export function nameProblem(name: string | null | undefined, slug?: string | null): string | null {
  const n = name?.trim() ?? '';
  if (!n) {
    return 'has no name';
  }
  if (isSlugName(n) || isTitledSlug(n, slug)) {
    return `"${n}" is the slug, not a name — say what is done, to what`;
  }
  const hit = VAGUE_NAME_WORDS.find(w => w.pattern.test(n));
  return hit ? `"${n}" uses ${hit.say}` : null;
}
