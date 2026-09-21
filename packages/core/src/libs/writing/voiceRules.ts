/**
 * Voice rules — the structural gate on outbound copy.
 *
 * A workspace's voice used to live entirely in prompt text (a playbook that
 * says "conversational, direct, low pressure"). Nothing checked the output,
 * and that instruction is itself what makes a model write "Curious about…"
 * and "No pitch, just…" — the guide's own words produce the tells. Asking
 * the model more nicely is the weakest available lever.
 *
 * So the rules are data and the check is code:
 *
 * - `PLATFORM_DEFAULT_VOICE_RULES` is core's floor — generic register
 *   hygiene that no business writer wants in their outbound, deliberately
 *   NOT anyone's taste. It is conservative on purpose: every entry carries
 *   the reason it is here, and anything arguable belongs in the workspace.
 * - A workspace authors its own sharp edges in `voice.yaml`, applied onto
 *   `project.voice_rules` (see `loadVoiceRules.ts`).
 * - `lintCopy` is pure and synchronous, so the same rules gate a skill turn's
 *   structured answer (`outboundCopy`), a rewrite's result, and a test.
 *
 * Per the manifesto's "extend the core, keep specifics at the edge": the
 * mechanism is core, the vocabulary is the workspace's.
 */

import { z } from 'zod';
import { emailBodyText } from './emailBody';

/** One banned construction, with the reason a reader can argue with. */
export type VoiceRule = {
  /**
   * Stable handle for this rule. Platform defaults all carry one so a
   * workspace can name a floor rule in `allow` and opt out of it in a diff a
   * person can read. Optional on workspace-authored rules.
   */
  id?: string;
  /**
   * The thing to look for. A plain string is matched as a literal phrase —
   * case-insensitive, word-boundary aware, tolerant of extra whitespace and
   * of either apostrophe. A `RegExp` is used as authored (the `i` flag is
   * added if absent); workspace YAML reaches this by setting `match: regex`.
   */
  pattern: string | RegExp;
  /** Why it is banned. Surfaced to the model on the corrective retry. */
  reason: string;
};

/** A softer steer: allowed, but say it this way instead. Never blocks. */
export type VoicePreference = {
  pattern: string | RegExp;
  /** What to write instead. */
  use: string;
  reason?: string;
};

export type VoiceRules = {
  /** Constructions that must never appear. Blocking. */
  never: VoiceRule[];
  /** Constructions to steer away from. Reported, never blocking. */
  prefer?: VoicePreference[];
  /**
   * Platform-default rule ids this workspace opts out of. The floor is a
   * default, not a cage — a workspace whose business really does write
   * "leverage" says so here, and the exemption is versioned in the same file
   * as the rest of the voice. Ignored on the platform list itself.
   */
  allow?: string[];
  /** Hard ceiling on the length of one send. Blocking when exceeded. */
  maxWordsPerSend?: number;
  /** Hard ceiling on explicit questions in one send. Blocking when exceeded. */
  maxAsksPerSend?: number;
  noExclamation?: boolean;
  noEmoji?: boolean;
  noEmDash?: boolean;
};

export type VoiceViolationKind
  = | 'never'
    | 'prefer'
    | 'exclamation'
    | 'emoji'
    | 'em-dash'
    | 'max-words'
    | 'max-asks';

export type VoiceViolation = {
  kind: VoiceViolationKind;
  /** The exact text that matched, as it appears in the copy. */
  span: string;
  /** Character offset of `span` in the linted text; -1 for whole-text rules. */
  index: number;
  reason: string;
  /** `prefer` violations are advisory; everything else blocks. */
  blocking: boolean;
};

export type VoiceLintResult = {
  /** True when nothing blocking matched. `prefer` hits leave this true. */
  ok: boolean;
  violations: VoiceViolation[];
};

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

const APOSTROPHES = '\'‘’ʼ´';
const EM_DASHES = /[—–]/g;
// Emoji and pictographs. Deliberately a coarse range check rather than a
// grapheme-accurate matcher: the answer only has to be "is there an emoji in
// here", and the span it reports is only ever shown next to the reason.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher for a literal phrase: case-insensitive, whitespace-flexible
 * (so a line wrap inside the phrase still matches), apostrophe-agnostic (so
 * the model's typographic `’` does not slip past a rule written with `'`),
 * and word-boundary anchored at each end that is a word character — "just
 * curious" must not fire inside "adjust curiousness".
 * @param phrase - The literal phrase to match.
 */
export function phraseToRegex(phrase: string): RegExp {
  const trimmed = phrase.trim();
  const body = escapeRegex(trimmed)
    .replace(/\\?\s+/g, '\\s+')
    .replace(new RegExp(`[${escapeRegex(APOSTROPHES)}]`, 'g'), `[${APOSTROPHES}]`);
  const left = /^\w/.test(trimmed) ? '\\b' : '';
  const right = /\w$/.test(trimmed) ? '\\b' : '';
  return new RegExp(`${left}${body}${right}`, 'gi');
}

function toMatcher(pattern: string | RegExp): RegExp {
  if (typeof pattern === 'string') {
    return phraseToRegex(pattern);
  }
  const flags = new Set([...pattern.flags, 'g', 'i']);
  return new RegExp(pattern.source, [...flags].join(''));
}

/**
 * Normalise line endings, so a `\s+` inside a phrase matcher spans a wrap.
 * @param text - The copy about to be linted.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Count the explicit asks in a send. Deliberately narrow: an explicit
 * question mark. Imperative asks ("grab 20 minutes next week") are not
 * counted, because the false-positive rate on detecting them in code is
 * worse than the miss — the playbook still tells the model the rule.
 * @param text - The send body.
 */
export function countAsks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/**
 * Count words in a send, for `maxWordsPerSend`.
 * @param text - The send body.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Check one piece of outbound copy against a rule set.
 *
 * Pure and synchronous: the same call gates a model answer, a rewrite, and a
 * unit test. Every violation names the offending span and the authored
 * reason, because the corrective retry hands both straight back to the model
 * and a reviewer has to be able to argue with the rule.
 * @param text - The copy to check (a subject or a body — one field at a time).
 * @param rules - The merged rule set.
 */
export function lintCopy(text: string, rules: VoiceRules): VoiceLintResult {
  const violations: VoiceViolation[] = [];
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: true, violations };
  }
  const src = normalize(text);

  // Keyed by matched span so the report has one line per thing to fix. Two
  // rules can legitimately catch the same words — a workspace restating a
  // platform-floor phrase in its own words is the common case — and the
  // workspace's reason should win, so a later rule replaces an earlier one.
  const banned = new Map<string, VoiceViolation>();
  for (const rule of rules.never ?? []) {
    const re = toMatcher(rule.pattern);
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) {
      banned.set(m[0].toLowerCase(), { kind: 'never', span: m[0], index: m.index, reason: rule.reason, blocking: true });
      if (m.index === re.lastIndex) {
        re.lastIndex += 1;
      }
      m = re.exec(src);
    }
  }
  violations.push(...[...banned.values()].sort((a, b) => a.index - b.index));

  for (const pref of rules.prefer ?? []) {
    const re = toMatcher(pref.pattern);
    const m = re.exec(src);
    if (m) {
      violations.push({
        kind: 'prefer',
        span: m[0],
        index: m.index,
        reason: pref.reason ? `${pref.reason} Write "${pref.use}" instead.` : `Write "${pref.use}" instead.`,
        blocking: false,
      });
    }
  }

  if (rules.noExclamation) {
    const i = src.indexOf('!');
    if (i >= 0) {
      violations.push({ kind: 'exclamation', span: '!', index: i, reason: 'No exclamation points.', blocking: true });
    }
  }

  if (rules.noEmoji) {
    const m = EMOJI.exec(src);
    if (m) {
      violations.push({ kind: 'emoji', span: m[0], index: m.index, reason: 'No emoji in outbound copy.', blocking: true });
    }
  }

  if (rules.noEmDash) {
    EM_DASHES.lastIndex = 0;
    const m = EM_DASHES.exec(src);
    if (m) {
      violations.push({ kind: 'em-dash', span: m[0], index: m.index, reason: 'No em-dashes or en-dashes.', blocking: true });
    }
  }

  if (typeof rules.maxWordsPerSend === 'number') {
    const words = countWords(src);
    if (words > rules.maxWordsPerSend) {
      violations.push({
        kind: 'max-words',
        span: `${words} words`,
        index: -1,
        reason: `Over the ${rules.maxWordsPerSend}-word ceiling for one send. Cut it.`,
        blocking: true,
      });
    }
  }

  if (typeof rules.maxAsksPerSend === 'number') {
    const asks = countAsks(src);
    if (asks > rules.maxAsksPerSend) {
      violations.push({
        kind: 'max-asks',
        span: `${asks} questions`,
        index: -1,
        reason: `More than ${rules.maxAsksPerSend} ask(s) in one send. Keep one.`,
        blocking: true,
      });
    }
  }

  return { ok: !violations.some(v => v.blocking), violations };
}

/**
 * One line per violation, in the shape the corrective retry and the review
 * queue both want: the span, then the reason.
 * @param violations - Violations from `lintCopy`.
 * @param field - Optional field label, e.g. `body of send 1`.
 */
export function describeViolations(violations: VoiceViolation[], field?: string): string {
  const prefix = field ? `${field}: ` : '';
  return violations
    .filter(v => v.blocking)
    .map(v => `${prefix}"${v.span}" is banned — ${v.reason}`)
    .join('\n');
}

/**
 * Merge the platform floor with a workspace's own list. Additive by design:
 * a workspace can add rules and tighten limits, and cannot delete a platform
 * rule — the floor is a floor. Booleans OR together; numeric ceilings take
 * the lower (stricter) of the two.
 * @param base - The platform default rules.
 * @param workspace - The workspace's authored rules, if any.
 */
export function mergeVoiceRules(base: VoiceRules, workspace?: VoiceRules | null): VoiceRules {
  if (!workspace) {
    return base;
  }
  const lower = (a?: number, b?: number) =>
    a === undefined ? b : b === undefined ? a : Math.min(a, b);
  const allowed = new Set(workspace.allow ?? []);
  const floor = (base.never ?? []).filter(r => !(r.id && allowed.has(r.id)));
  return {
    never: [...floor, ...(workspace.never ?? [])],
    prefer: [...(base.prefer ?? []), ...(workspace.prefer ?? [])],
    maxWordsPerSend: lower(base.maxWordsPerSend, workspace.maxWordsPerSend),
    maxAsksPerSend: lower(base.maxAsksPerSend, workspace.maxAsksPerSend),
    noExclamation: Boolean(base.noExclamation || workspace.noExclamation),
    noEmoji: Boolean(base.noEmoji || workspace.noEmoji),
    noEmDash: Boolean(base.noEmDash || workspace.noEmDash),
  };
}

/* ------------------------------------------------------------------ */
/* The platform floor                                                  */
/* ------------------------------------------------------------------ */

/**
 * Core's default banned list.
 *
 * The bar for an entry here is: it is a **register** problem in any business
 * outbound, in any workspace, for any writer — not a taste. Two families
 * qualify.
 *
 * 1. **Filler openers.** Sentences that carry no information and exist only
 *    to warm up ("I hope this finds you well"). Every recipient has read them
 *    a thousand times; they are the signature of a message written to a list.
 * 2. **Register announcements.** A line that tells the reader what kind of
 *    message this is instead of being that kind of message ("No pitch,
 *    just…", "Quick question"). These are the specific artefact of asking a
 *    model for "casual and low pressure": it performs the register rather
 *    than writing in it. They are the tells that started this.
 *
 * Plus a short list of model-vocabulary words ("delve", "supercharge") that
 * are not how humans write email.
 *
 * Everything arguable — how a particular founder opens, whether an em-dash is
 * allowed, whether "Happy to" is fine — is deliberately NOT here. That is the
 * workspace's `voice.yaml`.
 */
export const PLATFORM_DEFAULT_VOICE_RULES: VoiceRules = {
  never: [
    // --- filler openers: no information, signature of a list send ---
    { id: 'hope-finds-you-well', pattern: 'I hope this finds you well', reason: 'Filler opener. Carries no information and marks the note as a template.' },
    { id: 'hope-doing-well', pattern: 'Hope you are doing well', reason: 'Filler opener. Carries no information.' },
    { id: 'hope-doing-well-contracted', pattern: 'Hope you\'re doing well', reason: 'Filler opener. Carries no information.' },
    { id: 'checking-in', pattern: 'just checking in', reason: 'Filler. Says the sender wants something without saying what.' },
    { id: 'circling-back', pattern: 'circling back', reason: 'Filler. A follow-up should restate the ask, not name the act of following up.' },
    { id: 'touching-base', pattern: 'touching base', reason: 'Filler. Sales-CRM vocabulary, not how anyone speaks.' },
    { id: 'wanted-to-reach-out', pattern: 'I wanted to reach out', reason: 'Filler. Announces the act of writing instead of writing.' },
    { id: 'am-reaching-out', pattern: 'I am reaching out', reason: 'Filler. Announces the act of writing instead of writing.' },
    { id: 'i-noticed-that', pattern: 'I noticed that', reason: 'Padding in front of the actual observation. State the observation.' },
    { id: 'i-came-across', pattern: 'I came across', reason: 'Padding in front of the actual observation. State the observation.' },
    { id: 'fast-paced', pattern: 'in today\'s fast-paced', reason: 'Generic scene-setting. True of every company, so it says nothing.' },

    // --- register announcements: performing a tone instead of writing in it ---
    { id: 'no-pitch', pattern: 'no pitch', reason: 'Announces the register instead of being it. A note that is not a pitch does not need to say so.' },
    { id: 'not-a-pitch', pattern: 'not a pitch', reason: 'Announces the register instead of being it.' },
    { id: 'not-selling', pattern: 'not selling anything', reason: 'Announces the register instead of being it, and plants the idea of selling.' },
    { id: 'just-curious', pattern: 'just curious', reason: 'Announces the register instead of being it. Ask the question.' },
    { id: 'curious-about', pattern: /\bcurious\s+(about|if|whether|how|what|why)\b/, reason: 'Announces the register instead of being it. Ask the question directly.' },
    { id: 'quick-question', pattern: 'quick question', reason: 'Announces the register. Nothing is made quicker by calling it quick.' },
    { id: 'does-that-make-sense', pattern: 'does that make sense', reason: 'Asks the reader to validate the sender. Blocking filler at the end of a note.' },
    { id: 'bare-thoughts', pattern: 'thoughts?', reason: 'A non-ask standing in for an ask. Name the actual next step.' },
    { id: 'hope-that-helps', pattern: 'hope that helps', reason: 'Closing filler.' },
    { id: 'hope-this-helps', pattern: 'hope this helps', reason: 'Closing filler.' },

    // --- hedged non-offers: polite noise that carries no commitment ---
    { id: 'would-love-to', pattern: 'would love to', reason: 'Hedged non-offer. Say what you will do, or ask for the thing.' },
    { id: 'id-love-to', pattern: 'I\'d love to', reason: 'Hedged non-offer. Say what you will do, or ask for the thing.' },
    { id: 'happy-to', pattern: 'happy to', reason: 'Hedged non-offer. Offer the thing rather than a willingness to offer it.' },
    { id: 'feel-free-to', pattern: 'feel free to', reason: 'Hedged non-offer. Grants permission nobody asked for.' },
    { id: 'let-me-know-if', pattern: 'let me know if', reason: 'Hedged non-ask. Puts the work on the reader with no concrete step.' },

    // --- assistant vocabulary: how a chat model talks, not how people email ---
    { id: 'great-question', pattern: 'great question', reason: 'Assistant filler. Flatters rather than answers.' },
    { id: 'absolutely', pattern: /\babsolutely\s*[.,!]/, reason: 'Assistant filler as a standalone affirmation. (Scoped to the standalone use; "absolutely critical" is fine.)' },
    { id: 'delve', pattern: 'delve', reason: 'Model vocabulary. Almost nobody writes this in email.' },
    { id: 'leverage', pattern: 'leverage', reason: 'Model/consulting vocabulary. Name the thing you would actually do.' },
    { id: 'unlock', pattern: 'unlock', reason: 'Marketing vocabulary with no referent.' },
    { id: 'supercharge', pattern: 'supercharge', reason: 'Marketing vocabulary with no referent.' },
    { id: 'game-changer', pattern: 'game-changer', reason: 'Marketing vocabulary with no referent.' },
    { id: 'game-changer-two-words', pattern: 'game changer', reason: 'Marketing vocabulary with no referent.' },
  ],
  /**
   * Emoji are a register problem in outbound business email in any workspace,
   * so the floor bans them. Exclamation points and em-dashes are NOT here:
   * both appear in real founder correspondence, so banning them platform-wide
   * would be taste dressed as hygiene. A workspace that wants them gone says
   * so in `voice.yaml`.
   */
  noEmoji: true,
};

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

/**
 * A zod string that refuses banned copy.
 *
 * This is the whole point of the module. `runSkillTurn` already validates the
 * model's answer with the caller's schema and, on failure, retries once with
 * the zod error text quoted back to the model. Wrapping an outbound
 * `subject`/`body` field in this turns "please write in my voice" into a
 * validation contract: the phrase is named, the reason is named, and copy
 * that still carries the phrase after the retry never reaches the queue at
 * all — `runSkillTurn` throws instead.
 *
 * Only blocking violations become zod issues; `prefer` hits are advisory and
 * are reported elsewhere.
 * @param rules - The merged rule set.
 * @param label - Optional field label for the message, e.g. `body of send 1`.
 */
export function outboundCopy(rules: VoiceRules, label?: string) {
  return z.string().superRefine((value, ctx) => {
    for (const v of lintCopy(value, rules).violations) {
      if (!v.blocking) {
        continue;
      }
      ctx.addIssue({
        code: 'custom',
        message: `${label ? `${label}: ` : ''}"${v.span}" is banned — ${v.reason}`,
      });
    }
  });
}

/**
 * Lint a whole set of sends at once — every subject and every body — and
 * return one flat, human-readable report. Used by the action's `precheck`, so
 * that a proposal assembled outside a skill turn (a research pass, an API
 * caller, a replay) cannot route around the gate.
 * @param sends - The sends to check.
 * @param rules - The merged rule set.
 */
export function lintSends(
  sends: Array<{ step?: number; subject?: string; body?: string }>,
  rules: VoiceRules,
): { ok: boolean; report: string; count: number } {
  const lines: string[] = [];
  sends.forEach((send, i) => {
    const n = send.step ?? i + 1;
    for (const [field, text] of [['subject', send.subject], ['body', send.body]] as const) {
      if (typeof text !== 'string' || text === '') {
        continue;
      }
      // The WORDS, not the markup. A reviewer's body may be HTML, and a
      // banned phrase split across a tag (`<strong>game</strong> changer`)
      // walks straight through a regex over markup — the gate would pass copy
      // it exists to stop (`libs/writing/emailBody.ts`).
      const { violations } = lintCopy(emailBodyText(text), rules);
      const described = describeViolations(violations, `${field} of send ${n}`);
      if (described) {
        lines.push(described);
      }
    }
  });
  return { ok: lines.length === 0, report: lines.join('\n'), count: lines.length };
}
