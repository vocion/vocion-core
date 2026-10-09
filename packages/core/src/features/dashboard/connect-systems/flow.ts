/**
 * THE WALK-THROUGH, as a pure state machine ("Connect your systems").
 *
 * One objective with a progress line: at most one question ("Which of these
 * do you use?"), then one system at a time — Connect, Later or Skip — each
 * verified before the next, and a summary at the end. Stop ends the walk
 * where it stands and goes straight to the summary.
 *
 * Pure and typed so the rules are tested without a browser, and so the whole
 * walk can be wrapped as one objective later: its state says where it is
 * (`progressOf`) and what became of each system (`outcomes`).
 */

import type { ConnectCandidate, ConnectOutcome, ConnectPlan, ConnectVerification } from '@/libs/connect/systemsPlan';

/** Where the current system's step is. */
export type StepPhase
  = | { at: 'choose' }
    | { at: 'key' }
    | { at: 'authorizing' }
    | { at: 'settings' }
    | { at: 'verifying' }
    | { at: 'failed'; reason: string };

export type FlowState
  = | { phase: 'loading' }
    | { phase: 'error'; reason: string }
    | { phase: 'refused'; reason: string }
    | { phase: 'nothing'; plan: ConnectPlan }
    | { phase: 'question'; plan: ConnectPlan }
    | { phase: 'walk'; plan: ConnectPlan; queue: ConnectCandidate[]; index: number; step: StepPhase; outcomes: Record<string, ConnectOutcome>; previews: Record<string, string | null> }
    | { phase: 'summary'; plan: ConnectPlan; queue: ConnectCandidate[]; outcomes: Record<string, ConnectOutcome>; previews: Record<string, string | null> };

/** Where a walk was before a reload or a trip away (`walkMemory.ts`): the systems it is over, and what each came to. */
export type FlowResume = { picked?: string[]; outcomes: Record<string, ConnectOutcome> };

export type FlowEvent
  = | { type: 'loaded'; plan: ConnectPlan; resume?: FlowResume | null }
    | { type: 'load_failed'; reason: string }
    | { type: 'answered'; connectors: string[] }
    | { type: 'connect' }
    | { type: 'back' }
    | { type: 'saved' }
    | { type: 'login_returned'; ok: true; needsSettings: boolean }
    | { type: 'login_returned'; ok: false; reason: string }
    | { type: 'verified'; result: ConnectVerification }
    | { type: 'skip' }
    | { type: 'later' }
    | { type: 'stop' };

export const INITIAL: FlowState = { phase: 'loading' };

type Walk = Extract<FlowState, { phase: 'walk' }>;

/**
 * The walk over these systems, at the first one.
 * @param plan - The plan.
 * @param queue - The systems to walk, in order.
 */
function walk(plan: ConnectPlan, queue: ConnectCandidate[]): FlowState {
  if (queue.length === 0) {
    return { phase: 'summary', plan, queue, outcomes: {}, previews: {} };
  }
  return { phase: 'walk', plan, queue, index: 0, step: { at: 'choose' }, outcomes: {}, previews: {} };
}

/**
 * The walk picked up where it was: over the same systems (those still to
 * connect), each one already settled kept, at the first one that is not.
 * @param plan - The plan, read again.
 * @param resume - Where it was.
 */
function resumed(plan: ConnectPlan, resume: FlowResume): FlowState {
  const picked = resume.picked ? new Set(resume.picked) : null;
  const queue = picked ? plan.candidates.filter(c => picked.has(c.connector)) : plan.candidates;
  const outcomes: Record<string, ConnectOutcome> = {};
  for (const c of queue) {
    const o = resume.outcomes[c.connector];
    if (o) {
      outcomes[c.connector] = o;
    }
  }
  const index = queue.findIndex(c => !outcomes[c.connector]);
  if (index === -1) {
    return { phase: 'summary', plan, queue, outcomes, previews: {} };
  }
  return { phase: 'walk', plan, queue, index, step: { at: 'choose' }, outcomes, previews: {} };
}

/**
 * What to keep of a walk so a reload resumes it, or null before it is walking.
 * @param s - The state.
 */
export function resumeOf(s: FlowState): FlowResume | null {
  return s.phase === 'walk' || s.phase === 'summary' ? { picked: s.queue.map(c => c.connector), outcomes: s.outcomes } : null;
}

/**
 * Settle the current system and move to the next, or to the summary.
 * @param s - The walk.
 * @param outcome - What became of the current system.
 * @param preview - Its first-sync preview, when it connected.
 */
function settle(s: Walk, outcome: ConnectOutcome, preview: string | null = null): FlowState {
  const current = s.queue[s.index]!;
  const outcomes = { ...s.outcomes, [current.connector]: outcome };
  const previews = { ...s.previews, [current.connector]: preview };
  if (s.index + 1 >= s.queue.length) {
    return { phase: 'summary', plan: s.plan, queue: s.queue, outcomes, previews };
  }
  return { ...s, index: s.index + 1, step: { at: 'choose' }, outcomes, previews };
}

/**
 * The next state.
 * @param s - Where the walk is.
 * @param e - What happened.
 */
export function reduce(s: FlowState, e: FlowEvent): FlowState {
  if (e.type === 'loaded') {
    if (e.plan.refused) {
      return { phase: 'refused', reason: e.plan.refused };
    }
    if (e.plan.candidates.length === 0) {
      return { phase: 'nothing', plan: e.plan };
    }
    if (e.resume && (e.resume.picked || !e.plan.question)) {
      return resumed(e.plan, e.resume);
    }
    return e.plan.question ? { phase: 'question', plan: e.plan } : walk(e.plan, e.plan.candidates);
  }
  if (e.type === 'load_failed') {
    return { phase: 'error', reason: e.reason };
  }
  if (s.phase === 'question') {
    if (e.type === 'answered') {
      // In the plan's ranked order, whatever order they were picked in.
      const picked = new Set(e.connectors);
      return walk(s.plan, s.plan.candidates.filter(c => picked.has(c.connector)));
    }
    if (e.type === 'skip' || e.type === 'stop') {
      return { phase: 'summary', plan: s.plan, queue: [], outcomes: {}, previews: {} };
    }
    return s;
  }
  if (s.phase !== 'walk') {
    return s;
  }
  const current = s.queue[s.index]!;
  switch (e.type) {
    case 'connect': {
      if (s.step.at !== 'choose' && s.step.at !== 'failed') {
        return s;
      }
      // A login and a full form both open in a window of their own and come back here.
      const at = current.method.kind === 'key' ? 'key' : 'authorizing';
      return { ...s, step: { at } };
    }
    case 'back':
      return s.step.at === 'key' || s.step.at === 'settings' || s.step.at === 'authorizing' ? { ...s, step: { at: 'choose' } } : s;
    case 'saved':
      return s.step.at === 'key' || s.step.at === 'settings' ? { ...s, step: { at: 'verifying' } } : s;
    case 'login_returned':
      if (s.step.at !== 'authorizing') {
        return s;
      }
      if (!e.ok) {
        return { ...s, step: { at: 'failed', reason: e.reason } };
      }
      return { ...s, step: { at: e.needsSettings ? 'settings' : 'verifying' } };
    case 'verified':
      if (s.step.at !== 'verifying') {
        return s;
      }
      if (e.result.state === 'failed' || e.result.state === 'missing') {
        return { ...s, step: { at: 'failed', reason: e.result.reason } };
      }
      return settle(s, 'connected', e.result.preview);
    case 'skip':
      return settle(s, s.step.at === 'failed' ? 'failed' : 'skipped');
    case 'later':
      return settle(s, 'later');
    case 'stop': {
      // Stopping leaves everything not yet decided for later, and says so.
      const outcomes = { ...s.outcomes };
      for (const c of s.queue.slice(s.index)) {
        outcomes[c.connector] ??= 'later';
      }
      return { phase: 'summary', plan: s.plan, queue: s.queue, outcomes, previews: s.previews };
    }
    default:
      return s;
  }
}

/**
 * "Connect your systems · 2 of 5": where the walk is, or null outside it.
 * @param s - The state.
 */
export function progressOf(s: FlowState): { index: number; total: number } | null {
  return s.phase === 'walk' ? { index: s.index, total: s.queue.length } : null;
}

/**
 * The one line the summary leaves on the chat card: what connected, and what did not.
 * @param s - The finished walk.
 */
export function summaryLine(s: Extract<FlowState, { phase: 'summary' }>): string {
  const by = (o: ConnectOutcome) => s.queue.filter(c => s.outcomes[c.connector] === o).map(c => c.name);
  const parts: string[] = [];
  const connected = by('connected');
  parts.push(connected.length > 0 ? `Connected ${connected.join(', ')}` : 'Nothing connected');
  const later = by('later');
  if (later.length > 0) {
    parts.push(`later: ${later.join(', ')}`);
  }
  const skipped = [...by('skipped'), ...by('failed')];
  if (skipped.length > 0) {
    parts.push(`skipped: ${skipped.join(', ')}`);
  }
  return `${parts.join(' · ')}.`;
}
