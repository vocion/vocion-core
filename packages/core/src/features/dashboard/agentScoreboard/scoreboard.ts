import type { AgentScore, FlaggedTurn } from '@/services/evals/live/signals';
/**
 * THE AGENT SCOREBOARD'S ARITHMETIC (ADR 0010), apart from the markup so it
 * is tested on its own, as the Engines page's is: which window and agent the
 * URL asks for, each column of the board, and the lines that say what is and
 * is not being scored. The figures are `services/evals/live/signals.ts`'s.
 */
import type { OnlineEvaluationSummary } from '@/services/evals/online';

export const WINDOWS = [7, 30, 90] as const;
export type ScoreboardWindow = (typeof WINDOWS)[number];

/** What the page shows, from its URL. */
export type ScoreboardQuery = { days: ScoreboardWindow; agent: string | null };

export const SCOREBOARD_PATH = '/dashboard/evals/live';

/**
 * The window and agent a URL asks for; anything else is the default (30 days, every agent).
 * @param params - The page's search params.
 */
export function readScoreboardQuery(params: Record<string, string | string[] | undefined>): ScoreboardQuery {
  const one = (k: string) => (typeof params[k] === 'string' ? params[k] as string : undefined);
  const days = Number(one('days'));
  const agent = one('agent');
  return {
    days: (WINDOWS as readonly number[]).includes(days) ? days as ScoreboardWindow : 30,
    agent: agent && /^[a-z0-9][a-z0-9-]{0,63}$/.test(agent) ? agent : null,
  };
}

/**
 * The page's link with one part of the query changed; defaults are left out.
 * @param q - The query in force.
 * @param change - What to change.
 */
export function scoreboardHref(q: ScoreboardQuery, change: Partial<ScoreboardQuery>): string {
  const next = { ...q, ...change };
  const sp = new URLSearchParams();
  if (next.days !== 30) {
    sp.set('days', String(next.days));
  }
  if (next.agent) {
    sp.set('agent', next.agent);
  }
  const s = sp.toString();
  return `${SCOREBOARD_PATH}${s ? `?${s}` : ''}`;
}

/**
 * `3 (12%)`: a count of turns and its share; a dash when there were none.
 * @param count - Turns with the signal.
 * @param of - Turns.
 */
export function countShare(count: number, of: number): string {
  if (of === 0) {
    return '—';
  }
  return count === 0 ? '0' : `${count} (${Math.round((count / of) * 100)}%)`;
}

/**
 * `9/10`: of the judged turns where a dimension applied, how many passed; a dash when none did.
 * @param rate - Passed and applicable.
 * @param rate.passed - Passed.
 * @param rate.of - Applicable.
 */
export function passRate(rate: { passed: number; of: number }): string {
  return rate.of ? `${rate.passed}/${rate.of}` : '—';
}

/** One column of the board: its label, what it means, its value, and whether the value wants reading. */
export type BoardColumn = { key: string; label: string; hint: string; value: (s: AgentScore) => string; warn: (s: AgentScore) => boolean };

export const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'turns', label: 'Turns', hint: 'Finished turns in the window.', value: s => String(s.turns), warn: () => false },
  { key: 'flagged', label: 'Flagged', hint: 'Turns with any signal below: the ones worth reading.', value: s => countShare(s.flagged, s.turns), warn: s => s.flagged > 0 },
  { key: 'refused', label: 'Refused with action', hint: 'Said it could not do something while the action path was there, and did not take it.', value: s => countShare(s.refusedWithAction, s.turns), warn: s => s.refusedWithAction > 0 },
  { key: 'claimed', label: 'Claimed save', hint: '"Noted", "I\'ll remember" with no call that saves.', value: s => countShare(s.claimedSave, s.turns), warn: s => s.claimedSave > 0 },
  { key: 'failures', label: '≥3 failed calls', hint: 'Three or more tool calls failed in one turn.', value: s => countShare(s.toolFailures, s.turns), warn: s => s.toolFailures > 0 },
  { key: 'errors', label: 'Errors per call', hint: 'Failed tool calls over all tool calls.', value: s => (s.toolCalls ? `${Math.round((s.toolErrors / s.toolCalls) * 100)}%` : '—'), warn: s => s.toolCalls > 0 && s.toolErrors / s.toolCalls > 0.1 },
  { key: 'searches', label: 'Searches per turn', hint: 'Tool searches: how often a deferred tool had to be found.', value: s => (s.turns ? (s.searches / s.turns).toFixed(1) : '—'), warn: () => false },
  { key: 'judged', label: 'Judged', hint: 'Turns the nightly judge read: a sample, spread across agents and levels.', value: s => String(s.judged), warn: () => false },
  { key: 'grounded', label: 'Grounded', hint: 'Of the judged turns that stated specifics, those whose every specific was in a tool result or the person\'s message.', value: s => passRate(s.grounded), warn: s => s.grounded.of > 0 && s.grounded.passed < s.grounded.of },
  { key: 'args', label: 'Args right', hint: 'Of the judged turns whose calls needed a value the person gave or a result returned, those that passed it.', value: s => passRate(s.argsCorrect), warn: s => s.argsCorrect.of > 0 && s.argsCorrect.passed < s.argsCorrect.of },
  { key: 'loading', label: 'Tool loading', hint: 'How its tools were loaded (ADR 0009).', value: s => s.loading.join(', ') || '—', warn: () => false },
];

export const LEVEL_LABELS: Record<string, string> = { quick: 'Quick', standard: 'Standard', deep: 'Deep', unknown: 'Not set' };

export const FLAG_LABELS: Record<string, string> = {
  toolFailures: '≥3 failed calls',
  refusedWithAction: 'Refused with action',
  claimedSave: 'Claimed save',
  judgedUngrounded: 'Ungrounded (judged)',
  judgedWrongArgs: 'Wrong arguments (judged)',
  judgedRefusal: 'Refused (judged)',
};

/**
 * The agents the board has, for the filter pills, in board order.
 * @param scores - The board.
 */
export function agentsOf(scores: readonly AgentScore[]): string[] {
  return [...new Set(scores.map(s => s.agentSlug))];
}

/**
 * Where a flagged turn's conversation is, when it had one.
 * @param turn - The turn.
 */
export function turnHref(turn: Pick<FlaggedTurn, 'conversationId'>): string | null {
  return turn.conversationId ? `/dashboard/chat/${turn.conversationId}` : null;
}

/**
 * What the board cannot see, said plainly: whether AgentCore's online
 * evaluators are judging a sample of these turns too.
 * @param online - `describeOnlineEvaluation`, or null when nobody set it up.
 */
export function onlineLine(online: Pick<OnlineEvaluationSummary, 'enabled' | 'samplingPercentage' | 'evaluatorIds'> | null): string {
  if (!online) {
    return 'Signals are read off every turn; Judged, Grounded and Args right come from the nightly agent-evals-nightly sample. AgentCore online evaluation is not set up here.';
  }
  if (!online.enabled) {
    return 'Signals are read off every turn; Judged, Grounded and Args right come from the nightly agent-evals-nightly sample. AgentCore online evaluation is set up but switched off.';
  }
  return `Signals are read off every turn; Judged, Grounded and Args right come from the nightly agent-evals-nightly sample. AgentCore online evaluation also judges ${online.samplingPercentage}% of live sessions (${online.evaluatorIds.join(', ')}); its scores are in CloudWatch.`;
}

/**
 * The judge's verdict as flags, beside the per-turn ones: what it found wrong.
 * @param judge - The verdict, or null.
 */
export function judgedFlags(judge: FlaggedTurn['judge']): string[] {
  if (!judge) {
    return [];
  }
  return [
    ...(judge.grounded === false ? ['judgedUngrounded'] : []),
    ...(judge.argsCorrect === false ? ['judgedWrongArgs'] : []),
    ...(judge.unjustifiedRefusal === true ? ['judgedRefusal'] : []),
  ];
}
