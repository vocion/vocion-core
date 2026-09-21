/**
 * learning.adopt_rule — a correction a person made becomes a standing rule.
 *
 * Chris, 2026-09-20, after an evening of steering a proposal writer through
 * chat, one instruction per sheet: *"if I'm using the app and giving feedback
 * I WANT THAT TO IMPROVE THE APP. Don't make everything my job."* The loop
 * already existed — classify the feedback, propose a rule, a person adopts it
 * at `/dashboard/learnings` — and that queue is exactly the approval gate his
 * standing rule calls debt. A dozen corrections in one evening reached nobody.
 *
 * So adoption goes through the trust ladder instead of a queue, the same way
 * `wiki.write_page` does. The extractor proposes with a confidence; above the
 * workspace's learning bar (`defaults.learningEagerness`, 7/10 → 72% by
 * default — `libs/actions/eagerness.ts`) the rule adopts itself and shows in
 * Review › Decided with **Undo**; below the bar the card carries the person's
 * own words and the drafted rule, and a person decides. A workspace pins this
 * one kind with an `autoApproveAbove` in its own trust.yaml, which wins over
 * the dial. Autonomy is still earned (design value 4) — what earns it
 * here is that un-adopting is one click and the agent reads the store fresh
 * every run.
 *
 * Nothing new is stored: `execute` runs the EXISTING pipeline —
 * `recordProposedRule` (duplicate judge, occurrence counting, the evidence
 * row) and then `decideCandidate('approve')`, which is the same call the
 * dashboard button makes. A restatement of a rule already on file therefore
 * adopts nothing and raises an occurrence count, which is what makes "a lot
 * of feedback" cheap rather than noisy.
 */

import type { Action } from './types';
import { z } from 'zod';

const adoptRuleInput = z.object({
  /** The learning step the rule mounts into — the agent's own, normally. */
  stepName: z.string().min(1).max(120).optional(),
  /** The rule itself: imperative, standing, general enough for the next client. */
  ruleText: z.string().min(8).max(600),
  /** `correct` = change this; `reinforce` = keep doing this. */
  polarity: z.enum(['correct', 'reinforce']).default('correct'),
  /** The classifier's proposal for the memory type. */
  memoryType: z.enum(['preference', 'knowledge', 'procedure']).default('preference'),
  /** What the person actually wrote, kept as the evidence behind the rule. */
  note: z.string().min(1).max(2000),
  /** The agent whose work drew the correction. */
  agentSlug: z.string().max(120).optional(),
  /** The person who said it. */
  submittedBy: z.string().max(120).optional(),
  /** Why this is a rule and not a one-off — read back on the card and the run. */
  reason: z.string().min(1).max(500),
});

export type AdoptRuleInput = z.infer<typeof adoptRuleInput>;

/**
 * The rule text, flattened, for the dedup key: the same instruction twice in one turn is one proposal.
 * @param text
 */
function ruleKeyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export const learningAdoptRuleAction: Action<typeof adoptRuleInput> = {
  id: 'learning.adopt_rule',
  name: 'Adopt a rule from a correction',
  description: 'Turn a correction a person made to an agent\'s work into a standing rule in the agent\'s learning step. Reversible — Undo removes the rule and the agent stops reading it on the next turn.',
  inputSchema: adoptRuleInput,
  grant: 'write_learning',
  external: false,
  // The class the workspace's learning dial moves: this changes what the
  // system knows about how to work, nothing outside it, and Undo puts it
  // back. `defaults.learningEagerness` sets the bar (7 → 72%, 10 → 60%); a
  // `autoApproveAbove` in trust.yaml for this kind wins over the dial.
  selfImproving: true,
  dedupKeyFor: input => `learning.adopt_rule:${input.stepName ?? 'default'}:${ruleKeyOf(input.ruleText)}`,
  async reviewCard(_ctx, input) {
    return {
      title: `Adopt a rule: ${input.ruleText.slice(0, 90)}${input.ruleText.length > 90 ? '…' : ''}`,
      system: 'Learnings',
      confidenceSubject: 'This is a standing rule',
      summary: input.reason,
      fields: [
        { label: 'Rule', value: input.ruleText },
        { label: 'They said', value: input.note.slice(0, 400) },
        { label: 'Step', value: input.stepName ?? 'the agent\'s first learning step' },
        { label: 'Agent', value: input.agentSlug ?? 'unattributed' },
      ],
      nextAction: 'Approving files the rule in that step; the agent reads it before its next piece of work. Undo removes it again.',
      verbs: { approve: 'Adopt', reject: 'Not a rule' },
    };
  },
  async execute(ctx, input) {
    const { recordProposedRule } = await import('@/services/feedback/ruleRecorder');
    const { decideCandidate } = await import('@/services/LearningCandidateService');
    const decidedBy = ctx.reviewedBy ?? input.submittedBy ?? ctx.invokedBy ?? 'system';

    const recorded = await recordProposedRule({
      orgId: ctx.orgId,
      ruleText: input.ruleText,
      polarity: input.polarity,
      memoryType: input.memoryType,
      ...(input.stepName ? { stepName: input.stepName } : {}),
      note: input.note,
      agentSlug: input.agentSlug ?? null,
      submittedBy: input.submittedBy ?? null,
    });

    if (recorded.outcome === 'skipped') {
      return { outcome: 'skipped', reason: recorded.reason, ruleText: input.ruleText };
    }
    if (recorded.outcome === 'duplicate') {
      // Already said. The occurrence count went up inside `recordProposedRule`
      // and nothing was adopted, so there is nothing to undo — which is the
      // point: "a lot of feedback" should cost one row, not one rule each.
      return {
        outcome: 'duplicate',
        matchedKind: recorded.matched.kind,
        matchedId: String(recorded.matched.id),
        matchedRule: recorded.matched.ruleText,
        ruleText: input.ruleText,
      };
    }

    const decided = await decideCandidate({
      orgId: ctx.orgId,
      id: recorded.candidateId,
      decision: 'approve',
      decidedBy,
    });
    if (!decided.ok) {
      // The candidate is still pending and visible on the Learnings page, so
      // the feedback is not lost — only the automatic half failed.
      return { outcome: 'pending', candidateId: recorded.candidateId, reason: decided.error, ruleText: input.ruleText };
    }
    return {
      outcome: 'adopted',
      candidateId: recorded.candidateId,
      ruleKey: decided.ruleKey,
      stepName: decided.candidate.stepName,
      ruleText: input.ruleText,
    };
  },
  async undo(ctx, _input, result) {
    if (result.outcome !== 'adopted') {
      return { undone: false, reason: `nothing was adopted (${String(result.outcome)})` };
    }
    const id = Number(result.candidateId);
    if (!Number.isInteger(id) || id <= 0) {
      return { undone: false, reason: 'no candidate id on the run' };
    }
    const { unadoptCandidate } = await import('@/services/LearningCandidateService');
    const out = await unadoptCandidate({
      orgId: ctx.orgId,
      id,
      undoneBy: ctx.reviewedBy ?? 'system',
      reason: 'Undone from Review — the rule was adopted automatically and a person put it back.',
    });
    return { undone: out.undone, ruleKey: out.ruleKey, ...(out.reason ? { reason: out.reason } : {}) };
  },
};
