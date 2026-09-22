/**
 * Approving an architecture plan, as a decision a person can actually make.
 *
 * This is the one kind of thing a person should decide. It is direction and
 * tradeoffs: which approach, what it costs to undo, what was rejected and why.
 * It is not a retry, a routine release, a metadata correction or anything else
 * policy already covers.
 *
 * So the item says four things, every time, in the shape every decision in
 * Review is meant to carry:
 *
 *   1. the decision needed
 *   2. the recommendation
 *   3. the reason
 *   4. what happens on yes, on no, and on nothing
 *
 * The fourth is the one that is usually missing, and it is the one that makes
 * the queue honest. "On nothing" for a plan is not "it proceeds with the
 * default": the work does not start. That is what a gate means, and saying it
 * out loud is the difference between a person choosing to wait and a person not
 * knowing they are the thing being waited on.
 *
 * This module is deliberately pure and self-contained: no database, no ask row,
 * no queue. It takes the plan, the rule's verdict and the state of the work, and
 * returns the sentences. The Review surface renders them and `ReviewService`
 * carries the decision; neither needs changing for the wording to be right, and
 * the wording can be tested without a seeded queue.
 *
 * The Review refactor landed first, so `planApprovalContract` at the bottom of
 * this file is the one place these fields become a `DecisionContract`. The four
 * parts survive the mapping: the decision is the decision, the recommendation
 * is the recommendation, `why` carries the reason, and what happens on nothing
 * is exactly what `impactOfDelay` is for. Yes and no become the labelled
 * actions, which is the only honest place for them, because a person picks one.
 */

import type { DecisionContract } from './decisionContract';
import type { PlanDecision } from '@/services/factory/planRule';

/** Everything the wording is built from. All of it comes off records; none of it is invented here. */
export type PlanApprovalInput = {
  /** The plan record's id, for the link. */
  planId: number;
  /** The plan's own title: the approach, named. */
  planTitle: string;
  /** The approach paragraph, as written. */
  approach: string | null;
  /** What was considered and rejected. An empty list is a finding, not a formatting problem. */
  alternatives: string[];
  /** How the work will be verified. */
  verification: string | null;
  /** What the data or migration impact is. */
  dataImpact: string | null;
  /** The request this plans, for the sentence that says what is waiting. */
  requestTitle: string;
  /** What the plan rule decided for this work. */
  rule: PlanDecision;
  /** How many engineering tasks are waiting on this plan to be approved. Zero is normal: the contracts are written after. */
  tasksWaiting: number;
  /** Whether any worker run has already started on this work. A plan decided after the work ran is a record, not a gate. */
  workAlreadyRan: boolean;
};

export type PlanApprovalDecision = {
  /** What is being decided, in one line. */
  decision: string;
  /** What we recommend, and it is always a recommendation, never a default that happens by itself. */
  recommendation: string;
  /** Why we recommend it, grounded in the rule's own triggers rather than in a preference. */
  reason: string;
  onYes: string;
  onNo: string;
  onNothing: string;
  /** Whether other work is stopped until this is decided. The queue sorts on it and says so. */
  blocking: boolean;
  /** An honest estimate of the minutes, so a queue of decisions can be costed before it is opened. */
  minutes: number;
  /** What is missing from the plan itself. Shown to the approver, because approving an incomplete plan is the failure mode. */
  gaps: string[];
};

/**
 * The plan's own gaps, as things a person would otherwise have to notice. A
 * plan that answers none of these is a document rather than a design, and it is
 * better to say that above the approve button than after the work ships.
 * @param input - The plan and its surroundings.
 */
function planGaps(input: PlanApprovalInput): string[] {
  const gaps: string[] = [];
  if (input.approach === null || input.approach.trim() === '') {
    gaps.push('The plan does not say what the approach is, which is the one thing it exists to say.');
  }
  if (input.alternatives.length === 0) {
    gaps.push('Nothing is recorded as considered and rejected, so this reads as a first idea rather than a choice.');
  }
  if (input.verification === null || input.verification.trim() === '') {
    gaps.push('The plan does not say how this will be verified, so the acceptance criteria will be guessed at.');
  }
  if (input.dataImpact === null || input.dataImpact.trim() === '') {
    gaps.push('The plan does not say what happens to data that already exists. "None" is an answer; silence is not.');
  }
  return gaps;
}

/**
 * The plan approval, as the four things a decision has to state.
 * @param input - The plan, the rule's verdict, and the state of the work.
 */
export function planApprovalDecision(input: PlanApprovalInput): PlanApprovalDecision {
  const gaps = planGaps(input);
  const required = input.rule.level === 'required';
  const whys = input.rule.triggers.map(t => t.why);

  const reason = required
    ? `A plan is required here because ${whys.join(', and because ')}. ${whys.length === 1 ? 'That trigger' : 'Those triggers'} name work that is hard or impossible to undo by reverting a commit, which is why the approach is worth ten minutes before it is worth a worker run.`
    : input.rule.level === 'offered'
      ? `A plan was not required here. ${input.rule.offered === null ? 'It was written anyway.' : `It was offered because ${input.rule.offered}, and it was written rather than declined.`} You may approve it or say it was not needed.`
      : 'The rule asked for no plan on this work. It was written anyway, so this is a read rather than a gate.';

  const recommendation = gaps.length === 0
    ? 'Approve it. The approach is stated, the alternatives are on the record, and the verification is something you can check yourself.'
    : `Send it back. ${gaps.length === 1 ? 'One thing is missing' : `${gaps.length} things are missing`}, and approving around ${gaps.length === 1 ? 'it' : 'them'} is how a plan becomes a formality.`;

  const onNothing = required
    ? `Nothing happens, and nothing starts. No task contract is written and no worker runs: the work waits on you. ${input.tasksWaiting > 0 ? `${input.tasksWaiting} task${input.tasksWaiting === 1 ? '' : 's'} already written ${input.tasksWaiting === 1 ? 'is' : 'are'} held behind it.` : 'The contracts are written after this, so nothing is queued yet.'}`
    : 'Nothing happens. The plan stays a draft on the record and the work is free to proceed without it, because the rule did not require one.';

  return {
    decision: `Approve the approach for "${input.requestTitle}": ${input.planTitle}.`,
    recommendation,
    reason: input.workAlreadyRan
      ? `${reason} Note that work on this has already run. Approving now records the approach; it does not gate it.`
      : reason,
    onYes: `The plan is marked approved with your name and the time on it, and the task contracts are written from it. Each contract carries the plan id, so the worker builds this approach and stops rather than choosing another one.`,
    onNo: 'The plan is rejected and is not edited into a different one. A new plan is written and points back at this one, so the record still says what was believed today.',
    onNothing,
    blocking: required && !input.workAlreadyRan,
    minutes: Math.min(15, 4 + input.rule.triggers.length * 2 + (gaps.length > 0 ? 2 : 0)),
    gaps,
  };
}

/**
 * The same decision as the lines a queue row shows: a title, a subline, and the
 * four parts as a body a person can read without opening the plan.
 * @param input - The plan, the rule's verdict, and the state of the work.
 */
export function planApprovalLines(input: PlanApprovalInput): { title: string; subline: string; body: string } {
  const d = planApprovalDecision(input);
  return {
    title: d.decision,
    subline: `${d.blocking ? 'Blocking' : 'Not blocking'} · about ${d.minutes} min · ${d.gaps.length === 0 ? 'the plan answers everything it should' : `${d.gaps.length} gap${d.gaps.length === 1 ? '' : 's'} in the plan`}`,
    body: [
      `**The decision.** ${d.decision}`,
      `**The recommendation.** ${d.recommendation}`,
      `**Why.** ${d.reason}`,
      ...(d.gaps.length > 0 ? [`**What the plan does not answer.**\n${d.gaps.map(g => `- ${g}`).join('\n')}`] : []),
      `**On yes.** ${d.onYes}`,
      `**On no.** ${d.onNo}`,
      `**On nothing.** ${d.onNothing}`,
    ].join('\n\n'),
  };
}

/**
 * The plan approval as a Review row: the same decision, in the shape every item
 * in Review must carry before it is allowed to take a person's attention.
 *
 * The mapping is deliberate rather than mechanical. `impactOfDelay` gets "on
 * nothing" verbatim, because for a gate the cost of delay IS what happens when
 * nobody answers, and for a required plan that cost is that the work never
 * starts. The gaps ride on the send-back action's description rather than in
 * `why`, which holds at most two reasons and should hold the strongest ones,
 * not a checklist.
 * @param input - The plan, the rule's verdict, and the state of the work.
 */
export function planApprovalContract(input: PlanApprovalInput): DecisionContract {
  const d = planApprovalDecision(input);
  const sendBack = d.gaps.length === 0
    ? 'Say what is missing. The plan is rewritten and comes back here.'
    : d.gaps.join(' ');
  const approveIsRight = d.gaps.length === 0;
  return {
    decision: d.decision,
    recommendation: d.recommendation,
    recommendationWhyNot: null,
    why: [
      d.reason,
      ...(d.gaps.length > 0 ? [`${d.gaps.length === 1 ? 'One thing the plan does not answer' : `${d.gaps.length} things the plan does not answer`}, and approving around ${d.gaps.length === 1 ? 'it' : 'them'} is how a plan becomes a formality.`] : []),
    ],
    impactOfDelay: d.onNothing,
    actions: [
      { id: 'approve', label: 'Approve the approach', description: d.onYes, ...(approveIsRight ? { recommended: true } : {}) },
      { id: 'send-back', label: 'Send it back', description: sendBack, ...(approveIsRight ? {} : { recommended: true }) },
      { id: 'reject', label: 'Reject the approach', description: d.onNo },
    ],
  };
}
