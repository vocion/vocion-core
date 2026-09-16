/**
 * Reviewer edits as evidence about voice.
 *
 * The founder-voice playbook says "treat queue edit-diffs as corrections to
 * this guide". Nothing did. A reviewer who deletes the same phrase out of
 * every draft for a month was teaching the system nothing, because the only
 * thing the queue recorded about an edit was the boolean fact that one
 * happened — `updateActionInput` replaces the proposal wholesale and the
 * words the agent wrote are gone.
 *
 * So the diff is read at the one moment both versions exist, before that
 * write, and every phrase the reviewer DELETED that the voice rules did not
 * already catch is proposed as a new `never` rule. `ruleRecorder` does the
 * rest: the second time the same phrase is deleted it is recognised as a
 * duplicate and the candidate's `occurrence_count` goes up, so "he has cut
 * this three times" is one number a person can see.
 *
 * Nothing is adopted automatically. The candidate sits in Learnings until a
 * person accepts it, which is the manifesto's gate and also the honest
 * position: a deletion is evidence, not a verdict. A reviewer trimming a
 * sentence for length is indistinguishable in the diff from one deleting a
 * tell, and only a person can tell them apart.
 */

import type { VoiceRules } from '@/libs/writing/voiceRules';
import { logger } from '@/libs/Logger';
import { voiceConfigFor, voiceRulesFromStored } from '@/libs/writing/loadVoiceRules';
import { lintCopy } from '@/libs/writing/voiceRules';
import { recordProposedRule } from './ruleRecorder';

/** Shortest removed run worth proposing. One word is noise. */
const MIN_PHRASE_WORDS = 2;
/** Longest removed run worth proposing. Beyond this it is a deleted sentence, not a tell. */
const MAX_PHRASE_WORDS = 8;
/** Cap per decision, so one wholesale rewrite cannot flood the queue. */
const MAX_PHRASES_PER_DECISION = 3;

type Token = { text: string; norm: string };

function tokenize(text: string): Token[] {
  return (text.match(/\S+/g) ?? []).map(t => ({ text: t, norm: t.toLowerCase().replace(/^[^\w'’]+|[^\w'’]+$/g, '') }));
}

/**
 * Word-level longest-common-subsequence, so a phrase deleted from the middle
 * of an otherwise-kept sentence is seen as a deletion rather than as a
 * wholesale replacement. O(n·m) on token counts, which for an email body is
 * a few thousand cells.
 * @param before - Tokens of the proposed copy.
 * @param after - Tokens of the copy the reviewer approved.
 */
function removedRuns(before: Token[], after: Token[]): Token[][] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => Array.from<number>({ length: m + 1 }).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = before[i]!.norm === after[j]!.norm
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const runs: Token[][] = [];
  let run: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && before[i]!.norm === after[j]!.norm) {
      if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      i++;
      j++;
    } else if (j < m && table[i + 1]![j]! >= table[i]![j + 1]!) {
      run.push(before[i]!);
      i++;
    } else if (j < m) {
      j++;
    } else {
      run.push(before[i]!);
      i++;
    }
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

/**
 * Phrases the reviewer removed, filtered down to the ones that could
 * plausibly be a voice rule.
 *
 * Conservative on purpose, because a bad candidate costs a person's attention
 * in the Learnings queue:
 *
 * - runs of {@link MIN_PHRASE_WORDS}–{@link MAX_PHRASE_WORDS} words only;
 * - nothing containing a digit, a URL or an `@` — that is a fact being
 *   corrected, not a phrasing being rejected;
 * - nothing containing a capitalised word that is not sentence-initial — that
 *   is almost always a name, a company or a product, and banning it platform-
 *   wide would be a data leak as well as wrong;
 * - nothing the current rules already flag, because that phrase is already a
 *   rule and the drafting gate, not the learner, owns it.
 * @param before - The copy the agent proposed.
 * @param after - The copy the reviewer approved.
 * @param rules - The rules in force when the draft was produced.
 */
export function removedPhrases(before: string, after: string, rules: VoiceRules): string[] {
  if (!before.trim() || before.trim() === after.trim()) {
    return [];
  }
  const runs = removedRuns(tokenize(before), tokenize(after));
  const out: string[] = [];
  for (const run of runs) {
    if (run.length < MIN_PHRASE_WORDS || run.length > MAX_PHRASE_WORDS) {
      continue;
    }
    const phrase = run.map(t => t.text).join(' ').replace(/^[^\w'’]+|[^\w'’]+$/g, '').trim();
    if (phrase.split(/\s+/).length < MIN_PHRASE_WORDS) {
      continue;
    }
    if (/\d|https?:\/\/|@|\bwww\./i.test(phrase)) {
      continue;
    }
    // A capitalised token anywhere but the first position reads as a proper
    // noun. Skipping the whole run is the safe direction to be wrong in.
    if (run.slice(1).some(t => /^[A-Z]/.test(t.text))) {
      continue;
    }
    // Already a rule: the gate should have caught it, and re-proposing it
    // would fill the queue with things that are already decided.
    if (!lintCopy(phrase, rules).ok) {
      continue;
    }
    out.push(phrase);
    if (out.length >= MAX_PHRASES_PER_DECISION) {
      break;
    }
  }
  return out;
}

/**
 * Every piece of outbound copy in an action's input, labelled.
 * @param input - The action run's `input` jsonb.
 */
export function copyFieldsOf(input: Record<string, unknown> | null | undefined): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  if (!input) {
    return out;
  }
  const sends = Array.isArray(input.sends) ? input.sends as Array<Record<string, unknown>> : null;
  if (sends) {
    for (const send of sends) {
      const step = Number(send.step);
      const n = Number.isFinite(step) ? step : sends.indexOf(send) + 1;
      if (typeof send.subject === 'string') {
        out.push({ label: `send-${n}.subject`, text: send.subject });
      }
      if (typeof send.body === 'string') {
        out.push({ label: `send-${n}.body`, text: send.body });
      }
    }
    return out;
  }
  const props = (input.properties ?? {}) as Record<string, unknown>;
  for (const [label, value] of [
    ['subject', input.subject],
    ['body', input.body],
    ['notes', input.notes ?? props.notes],
  ] as const) {
    if (typeof value === 'string' && value.trim() !== '') {
      out.push({ label, text: value });
    }
  }
  return out;
}

/**
 * Compare a proposal's copy with what the reviewer approved and file the
 * deletions as proposed voice rules.
 *
 * Opt-in: a workspace has to name the learnings step in `voice.yaml`
 * (`learningStep:`). Without it nothing is recorded — a voice rule filed into
 * an unrelated step would be worse than no rule, because it would train the
 * wrong agent and be hard to find.
 *
 * Never throws: losing a learning signal must not fail a reviewer's approve.
 * @param opts - Everything the capture needs.
 * @param opts.orgId - The project id.
 * @param opts.runId - The action run being decided.
 * @param opts.before - The action input the agent proposed.
 * @param opts.after - The action input the reviewer approved.
 * @param opts.userId - Who edited.
 * @param opts.agentSlug - The proposing agent, when known.
 */
export async function recordVoiceEdits(opts: {
  orgId: string;
  runId: number;
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
  userId?: string;
  agentSlug?: string;
}): Promise<{ recorded: number; reason?: string }> {
  try {
    const config = await voiceConfigFor(opts.orgId);
    const stepName = config?.learningStep;
    if (!stepName) {
      return { recorded: 0, reason: 'no_voice_learning_step' };
    }
    const rules = voiceRulesFromStored(config);
    const after = copyFieldsOf(opts.after);
    const byLabel = new Map(after.map(f => [f.label, f.text]));

    const phrases = new Set<string>();
    for (const field of copyFieldsOf(opts.before)) {
      const edited = byLabel.get(field.label);
      if (edited === undefined) {
        continue;
      }
      for (const phrase of removedPhrases(field.text, edited, rules)) {
        phrases.add(phrase);
      }
      if (phrases.size >= MAX_PHRASES_PER_DECISION) {
        break;
      }
    }
    if (phrases.size === 0) {
      return { recorded: 0, reason: 'no_candidate_phrases' };
    }

    let recorded = 0;
    for (const phrase of [...phrases].slice(0, MAX_PHRASES_PER_DECISION)) {
      const result = await recordProposedRule({
        orgId: opts.orgId,
        // Written as a rule, not as an observation, because that is what a
        // person is being asked to adopt.
        ruleText: `Never write "${phrase}" in outbound copy.`,
        polarity: 'correct',
        stepName,
        note: `A reviewer deleted "${phrase}" from a draft before approving it (action run ${opts.runId}).`,
        agentSlug: opts.agentSlug,
        sourceRunId: opts.runId,
        submittedBy: opts.userId,
      });
      if (result.outcome !== 'skipped') {
        recorded += 1;
      }
    }
    logger.info('voice learning: reviewer edit produced rule candidates', {
      orgId: opts.orgId,
      runId: opts.runId,
      stepName,
      phrases: phrases.size,
      recorded,
    });
    return { recorded };
  } catch (error) {
    logger.warn('voice learning: could not record the edit diff', {
      orgId: opts.orgId,
      runId: opts.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { recorded: 0, reason: 'error' };
  }
}
