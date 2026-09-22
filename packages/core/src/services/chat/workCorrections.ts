/**
 * Learning from the work, not from being asked to learn.
 *
 * 2026-09-20. A real client proposal came back a wall of text. Chris fixed it
 * by steering the Proposal Writer through chat, one instruction per sheet —
 * put the client's lockup and the term strip on the cover; give the gap sheet
 * a deliberately plain window showing the spreadsheet they use now; render the
 * three products as side-by-side windows. Every instruction worked. Not one of
 * them reached Vocion: the only route a correction had into the learning store
 * was the agent remembering to call `add_learning`, and across a dozen
 * corrections that night it fired zero times. *"How do we make sure that
 * style/tone/playbook is in core for future — it should learn from our work in
 * Vocion, not here in chat. Codify it, make it self learning."*
 *
 * A prompt line asking the agent to remember is the weakest lever there is
 * (CLAUDE.md, *structural over prompting*), so this module is the structure:
 *
 *   1. **A deterministic trigger.** The turn changed a document AND the
 *      person's message reads as an instruction. Both are facts the route
 *      already has — the collector's tool runs, and the message. No model.
 *   2. **A pure judgement**, tested: which sentences are directives, and how
 *      sure we are that each is a standing rule rather than an aside.
 *      Strict on purpose. A wrong rule adopted silently is the failure that
 *      would make a person turn this off, so anything that is not plainly an
 *      instruction produces nothing at all.
 *   3. **A thin model call**, gated behind both, that turns those sentences
 *      into rules the NEXT client's document can be held to. It fails closed:
 *      unparseable output files nothing.
 *   4. **Adoption through the trust ladder**, not a queue
 *      (`libs/actions/learning-adopt-rule.ts`). Above the workspace's
 *      learning bar (`defaults.learningEagerness`, 7/10 → 72%) the rule
 *      adopts itself and shows with Undo; below it, a person decides on a
 *      card carrying their own words. Approval gates are debt.
 */

import { proposeAction } from '@/services/ActionService';

/**
 * The tools whose use means this turn CHANGED the work — not merely looked at
 * it. `verify_document` and `read_document` are reads; a correction answered
 * by a read is a correction that has not landed yet.
 */
export const WORK_WRITE_TOOLS: readonly string[] = ['render_document', 'edit_document'];

/** Confidence for an unhedged directive in the person's own words. */
export const DIRECTIVE_CONFIDENCE = 0.9;

/** Confidence for a hedged one, an aside, or anything we had to infer. */
export const HEDGED_CONFIDENCE = 0.5;

export type Directive = {
  /** The sentence, as the person wrote it. */
  text: string;
  /** 0–1: how sure we are this is a standing instruction. */
  confidence: number;
  /** Which signal decided, for the run's reason line. */
  why: string;
};

/**
 * Words that make a sentence a standing rule rather than a one-off ask.
 * Any of them, anywhere in the sentence, and the form is settled.
 */
const STANDING = /\b(?:never|always|every (?:sheet|page|time|document|proposal)|each (?:sheet|page)|from now on|going forward|in future|by default|as a rule|no more|don'?t ever|stop)\b/i;

/**
 * Verbs a person starts a correction with. A closed list on purpose: an
 * unrecognised opening produces no candidate, and no candidate is better than
 * a wrong one. Add to it from real transcripts, never from imagination.
 */
const IMPERATIVES = new Set([
  'add',
  'align',
  'avoid',
  'bold',
  'call',
  'caption',
  'change',
  'cut',
  'delete',
  'drop',
  'fix',
  'give',
  'include',
  'keep',
  'kill',
  'label',
  'lead',
  'lose',
  'make',
  'merge',
  'move',
  'name',
  'number',
  'pin',
  'put',
  'reduce',
  'remove',
  'rename',
  'render',
  'reorder',
  'replace',
  'rewrite',
  'say',
  'set',
  'shorten',
  'show',
  'shrink',
  'simplify',
  'split',
  'start',
  'stop',
  'swap',
  'tighten',
  'title',
  'trim',
  'use',
  'widen',
  'write',
]);

/**
 * Openings that sit in front of the instruction rather than being it —
 * "maybe put…", "also, cut…", "please move…". Stripped before the imperative
 * is read, so a hedged instruction is caught AS hedged (it asks) instead of
 * vanishing because "maybe" is not a verb.
 */
const LEADING_FILLER = /^(?:maybe|perhaps|possibly|probably|actually|also|and|but|so|then|right|ok(?:ay)?|please|i think|i'?d say|one more thing)\b[\s,:—-]*/i;

/** A negated imperative: "no wall of text", "not the dark window", "don't lead with the negative". */
const NEGATED = /^(?:no|not|never|don'?t|do not|stop)\b/i;

/** Hedges that turn an instruction into a suggestion — it asks rather than adopts. */
const HEDGE = /\b(?:maybe|perhaps|might|probably|i think|i'?d|i would|could you|can you|possibly|not sure|if you can|feel free|prefer|kind of|sort of)\b/i;

/** Approval, thanks and acknowledgement — never a rule, whatever verb they open with. */
const APPROVAL = /^(?:ship it|send it|looks? (?:great|good|right|fine)|perfect|nice|great|lovely|thanks?|thank you|ta|yes|yep|yeah|ok(?:ay)?|sure|lgtm|good|done|cool|👍)\b/i;

/**
 * The sentences in a person's message that read as standing instructions,
 * each with how sure we are.
 *
 * Pure, and strict: a question, an approval, a sentence too short to carry a
 * rule or long enough to be a paragraph, and anything that neither opens with
 * an imperative nor carries a standing word, all produce nothing.
 * @param message - What the person wrote.
 */
export function directivesIn(message: string): Directive[] {
  const out: Directive[] = [];
  for (const raw of splitSentences(message)) {
    const text = raw.trim();
    const words = text.split(/\s+/);
    if (words.length < 3 || words.length > 60) {
      continue;
    }
    if (text.endsWith('?') || APPROVAL.test(text)) {
      continue;
    }
    const standing = STANDING.test(text);
    const core = text.replace(LEADING_FILLER, '').trim();
    const first = (core.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z']/g, '');
    const imperative = IMPERATIVES.has(first) || NEGATED.test(core);
    if (!standing && !imperative) {
      continue;
    }
    const hedged = HEDGE.test(text);
    out.push({
      text,
      confidence: hedged ? HEDGED_CONFIDENCE : DIRECTIVE_CONFIDENCE,
      why: hedged
        ? 'hedged — a suggestion rather than a directive'
        : standing
          ? 'a standing instruction in the person\'s own words'
          : 'a direct instruction in the person\'s own words',
    });
    if (out.length === 6) {
      break;
    }
  }
  return out;
}

/**
 * Sentences, by terminator or line break. Bullet markers are stripped,
 * because a person listing corrections writes them as a list.
 * @param message
 */
function splitSentences(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

export type WorkCorrection = {
  /** The write tool whose use made this a correction to the work. */
  via: string;
  /** What the person instructed, in their words. */
  directives: Directive[];
};

/**
 * The trigger. Deterministic, and it costs nothing: a turn that changed a
 * document, answering a message that instructed.
 *
 * Both halves matter. Without the write, "cut page 9" said to an agent that
 * did nothing is not evidence of anything. Without the instruction, every
 * document edit would draft a rule out of "yes please".
 * @param opts
 * @param opts.message - The person's message that started the turn.
 * @param opts.toolNames - The tools the turn actually ran.
 */
export function correctionInTurn(opts: { message: string; toolNames: readonly string[] }): WorkCorrection | null {
  const via = opts.toolNames.find(n => WORK_WRITE_TOOLS.includes(n));
  if (!via) {
    return null;
  }
  const directives = directivesIn(opts.message);
  return directives.length > 0 ? { via, directives } : null;
}

/** One rule the model drafted out of the person's words. */
export type DraftedRule = {
  /** Imperative, standing, and general enough for the next client. */
  rule: string;
  /**
   * Whether it holds for any client. False for anything specific to this one
   * — a name, a price, a product — and a rule that does not generalise never
   * adopts itself, however plainly it was said.
   */
  generalises: boolean;
};

/**
 * How sure we are that THIS drafted rule should stand, which is the number the
 * trust ladder measures against the bar.
 *
 * The person's form sets the ceiling; a rule the model says is specific to
 * this client is pulled below the bar whatever they said, because the failure
 * we cannot afford is a one-off adopted as house style.
 * @param directive - The sentence it came from.
 * @param drafted - What the model made of it.
 */
export function ruleConfidence(directive: Directive, drafted: DraftedRule): number {
  return drafted.generalises ? directive.confidence : Math.min(directive.confidence, HEDGED_CONFIDENCE);
}

export type DraftFn = (directives: ReadonlyArray<Directive>) => Promise<DraftedRule[]>;

/**
 * The model half: the person's sentences in, standing rules out.
 *
 * Thin by design — one cheap call, strict JSON, at most three rules — and it
 * fails closed. An unparseable answer files nothing, which is the right
 * failure: the correction is still in the transcript, and nobody has been
 * given a rule nobody wrote.
 * @param orgId
 */
export function draftWithModel(orgId: string): DraftFn {
  return async (directives) => {
    const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 500, streaming: false });
    const res = await model.invoke([
      {
        role: 'system',
        content: [
          'A person just corrected an AI agent\'s work on a client document, in chat.',
          'Turn what they said into STANDING RULES for the next client\'s document.',
          'Each rule: imperative, under 35 words, about style, structure, tone or process — not a fact about this client.',
          'Strip this client\'s name, product names, prices and dates out of the rule.',
          'Set "generalises" false when the instruction is only true of this one client or this one document.',
          'Return STRICT JSON: {"rules":[{"rule":"…","generalises":true}]} — at most 3, and [] when there is no standing rule in what they said.',
        ].join(' '),
      },
      { role: 'user', content: directives.map(d => `- ${d.text}`).join('\n') },
    ]);
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    return parseDraftedRules(text);
  };
}

/**
 * The model's answer, read defensively. Exported because the shape is the
 * contract, and a shape test is cheaper than a live model.
 * @param text - Whatever came back.
 */
export function parseDraftedRules(text: string): DraftedRule[] {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b <= a) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(a, b + 1));
  } catch {
    return [];
  }
  const rules = (parsed as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) {
    return [];
  }
  const out: DraftedRule[] = [];
  for (const r of rules) {
    const rule = typeof (r as { rule?: unknown })?.rule === 'string' ? (r as { rule: string }).rule.trim() : '';
    if (rule.length < 8 || rule.length > 600) {
      continue;
    }
    out.push({ rule, generalises: (r as { generalises?: unknown })?.generalises !== false });
    if (out.length === 3) {
      break;
    }
  }
  return out;
}

export type LearnedRule = {
  rule: string;
  confidence: number;
  /** The action run, so the receipt can point at the thing to undo. */
  runId: number;
  /** `executed` (adopted itself) / `pending` (asked) / `duplicate` / `failed`. */
  state: 'executed' | 'pending' | 'duplicate' | 'failed';
  detail?: string;
};

/**
 * One receipt for the whole turn, listing what was learned and what was asked
 * about. One line per rule, each naming its own run, because each is undone
 * on its own — five separate notices for one evening's corrections would be
 * the noise that gets the feature turned off.
 * @param learned - What came back from the ladder.
 * @param stepName - Where the rules mount, for the sentence.
 */
export function learningReceipt(learned: ReadonlyArray<LearnedRule>, stepName: string | undefined): string | null {
  const adopted = learned.filter(l => l.state === 'executed');
  const asked = learned.filter(l => l.state === 'pending');
  const repeated = learned.filter(l => l.state === 'duplicate');
  if (adopted.length === 0 && asked.length === 0 && repeated.length === 0) {
    return null;
  }
  const where = stepName ? ` in **${stepName}**` : '';
  const lines: string[] = [];
  if (adopted.length > 0) {
    lines.push(`Learned from that — ${adopted.length} ${adopted.length === 1 ? 'rule' : 'rules'} now standing${where}:`);
    for (const l of adopted) {
      lines.push(`- ${l.rule} · undo in Review › Decided (run #${l.runId})`);
    }
  }
  if (asked.length > 0) {
    lines.push(`${asked.length} ${asked.length === 1 ? 'rule is' : 'rules are'} waiting on you in Review — I was not sure enough to adopt ${asked.length === 1 ? 'it' : 'them'}:`);
    for (const l of asked) {
      lines.push(`- ${l.rule} (run #${l.runId})`);
    }
  }
  if (repeated.length > 0) {
    lines.push(`${repeated.length} ${repeated.length === 1 ? 'was' : 'were'} already on file; ${repeated.length === 1 ? 'its' : 'their'} occurrence count went up instead.`);
  }
  return lines.join('\n');
}

/**
 * Which learning step the rules land in: the agent's own first declared step
 * (the proposals plugin ships `proposal-feedback` and the Proposal Writer
 * declares it), and otherwise nothing — `recordProposedRule` then falls back
 * to the org's first step, exactly as review feedback does.
 * @param orgId
 * @param agentSlug
 */
export async function learningStepFor(orgId: string, agentSlug: string | undefined): Promise<string | undefined> {
  if (!agentSlug) {
    return undefined;
  }
  try {
    const { getAgent } = await import('@/services/AgentService');
    const agent = await getAgent(orgId, agentSlug);
    return agent?.learningSteps?.[0];
  } catch {
    return undefined;
  }
}

/**
 * The whole loop for one turn: draft the rules, propose each through the
 * trust ladder, and hand back the receipt.
 *
 * Fire-and-forget from the stream route. Nothing here may cost the person
 * their turn, so every failure returns an empty result rather than throwing.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.userId
 * @param opts.correction - What {@link correctionInTurn} found.
 * @param opts.draft - Injectable model call; defaults to the classifier.
 */
export async function learnFromWorkCorrection(opts: {
  orgId: string;
  agentSlug?: string;
  userId?: string;
  correction: WorkCorrection;
  draft?: DraftFn;
}): Promise<{ learned: LearnedRule[]; stepName?: string; receipt: string | null }> {
  const drafted = await (opts.draft ?? draftWithModel(opts.orgId))(opts.correction.directives);
  if (drafted.length === 0) {
    return { learned: [], receipt: null };
  }
  const stepName = await learningStepFor(opts.orgId, opts.agentSlug);
  // One directive per rule where the counts line up, and the strongest
  // directive otherwise — the model may fold two sentences into one rule.
  const strongest = opts.correction.directives.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const note = `Chat correction while a client document was open (${opts.correction.via}). The person wrote:\n${opts.correction.directives.map(d => `- ${d.text}`).join('\n')}`;

  const learned: LearnedRule[] = [];
  for (const [i, d] of drafted.entries()) {
    const source = drafted.length === opts.correction.directives.length
      ? opts.correction.directives[i] ?? strongest
      : strongest;
    const confidence = ruleConfidence(source, d);
    try {
      const res = await proposeAction({
        orgId: opts.orgId,
        actionId: 'learning.adopt_rule',
        input: {
          ...(stepName ? { stepName } : {}),
          ruleText: d.rule,
          polarity: 'correct',
          memoryType: 'preference',
          note,
          ...(opts.agentSlug ? { agentSlug: opts.agentSlug } : {}),
          ...(opts.userId ? { submittedBy: opts.userId } : {}),
          reason: `${source.why}: "${source.text.slice(0, 160)}"${d.generalises ? '' : ' — but it reads as specific to this client, so a person should decide'}`,
        },
        principal: {
          kind: 'agent',
          id: opts.agentSlug ? `agent:${opts.agentSlug}` : 'agent:unknown',
          scope: { orgId: opts.orgId },
          grants: ['*'],
          autonomy: 2,
        },
        invokedBy: opts.agentSlug ? `agent:${opts.agentSlug}` : opts.userId,
        proposal: {
          confidence,
          rationale: source.text.slice(0, 400),
          ...(opts.agentSlug ? { agentSlug: opts.agentSlug } : {}),
          suggestedDecision: 'approve',
          suggestedDecisionReason: source.why.slice(0, 160),
        },
      });
      const outcome = (res.result ?? {}) as { outcome?: string };
      learned.push({
        rule: d.rule,
        confidence,
        runId: res.runId,
        state: res.status === 'pending'
          ? 'pending'
          : outcome.outcome === 'duplicate'
            ? 'duplicate'
            : outcome.outcome === 'adopted' ? 'executed' : 'failed',
        ...(outcome.outcome && outcome.outcome !== 'adopted' ? { detail: outcome.outcome } : {}),
      });
    } catch (error) {
      // One refused proposal must not lose the others.
      learned.push({ rule: d.rule, confidence, runId: 0, state: 'failed', detail: (error as Error).message.split('\n')[0] });
    }
  }
  return { learned, ...(stepName ? { stepName } : {}), receipt: learningReceipt(learned, stepName) };
}
