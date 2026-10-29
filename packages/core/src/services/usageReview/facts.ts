/**
 * The facts of one chat thread or one decided approval, computed in code.
 *
 * The daily usage review reads how people used the workspace — did each chat
 * get them where they wanted, and what got in the way. A model may interpret
 * a thread (`judge.ts`), but it never counts: turns, durations, spend, the
 * model and effort level each turn ran at, tool failures and re-asks are all
 * worked out here, from rows the platform already writes, and handed to the
 * judge as numbers. The same facts are the whole report for an Org that does
 * not let the review read chat content (`privacy.ts`): counts, timings,
 * failures and outcomes inferred from the thread's structure.
 *
 * Pure: no database and no model. `reader.ts` loads the rows.
 *
 * Re-asks are found by structure and by text similarity worked out here
 * (trigram overlap between a person's own messages), never by a model and
 * never by matching words: a message that repeats an earlier one, a message
 * right after a turn that failed, and a message right after a turn the person
 * marked down each count, with the turn that shows it.
 */

import type { EffortLevel } from '@/libs/llm/modelPrefs';
import { ENVELOPES } from '@/services/agents/effort';
import { trigramJaccard, trigrams } from '@/services/MemoryService';

/** How close two of a person's messages must be to count as asking the same thing again. */
export const REASK_SIMILARITY = 0.45;

/** A turn's endings that left the person without an answer. */
const FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'incomplete', 'refused', 'truncated']);

/** A message in a thread, as the reader loads it. `content` is empty when the review may not read content. */
export type ReviewMessage = {
  id: number;
  role: string;
  content: string;
  createdAt: Date;
  /** `conversation_message.status`; null reads as complete. */
  status: string | null;
  statusReason: string | null;
  microCents: number | null;
  feedbackRating: string | null;
  agentSlug: string | null;
  /** When the turn started and finished, from the turn ledger, when it was written. */
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

/** One model call (`model_call`), for the model and effort a turn ran at. */
export type ReviewModelCall = {
  messageId: number | null;
  model: string;
  effortLevel: string | null;
  createdAt: Date;
};

/** One tool call (`tool_call`) in the thread. */
export type ReviewToolCall = {
  tool: string;
  failed: boolean;
  durationMs: number | null;
  createdAt: Date;
};

/** A decision a person took on an agent's proposal or ask (`decision_alignment`). */
export type ReviewDecision = {
  subjectKind: string;
  subjectKey: string;
  subjectId: number;
  agentSlug: string | null;
  decision: string;
  recommended: string | null;
  agreed: boolean | null;
  hasNote: boolean;
  decidedAt: Date;
  /** When it was proposed or asked, for how long it waited. */
  proposedAt: Date | null;
};

/** The facts of one assistant turn. */
export type TurnFacts = {
  messageId: number;
  agentSlug: string | null;
  /** The effort level it ran at, when its model calls recorded one. */
  effort: EffortLevel | null;
  /** The model that answered (its last call), when recorded. */
  model: string | null;
  /** Whether that level thinks: off at Quick, the agent's own at Standard, high at Deep. */
  thinking: 'off' | 'agent' | 'high' | null;
  seconds: number | null;
  cents: number;
  status: string;
  statusReason: string | null;
  toolCalls: number;
  toolFailures: string[];
  rating: 'up' | 'down' | null;
};

export type ReaskKind = 'repeat' | 'after_failure' | 'after_thumbs_down';

/** One message that asked again, and the turn that shows it. */
export type Reask = {
  messageId: number;
  kind: ReaskKind;
  /** The earlier message it repeats, for `repeat`. */
  repeats?: number;
  /** Trigram overlap with it, 0–1, for `repeat`. */
  similarity?: number;
};

export type EffortSignalKind = 'reasked_after_quick' | 'hit_ceiling' | 'over_target' | 'deep_for_light_work';

/** A sign, from the numbers, that a turn's effort level did not fit the request. */
export type EffortSignal = {
  messageId: number;
  level: EffortLevel;
  signal: EffortSignalKind;
  /** The level the numbers point to. */
  suggests: EffortLevel;
};

export type ThreadFacts = {
  personMessages: number;
  turns: TurnFacts[];
  /** First message to last, seconds. */
  spanSeconds: number;
  /** Turn time summed, seconds. */
  workSeconds: number;
  cents: number;
  failedTurns: number;
  toolCalls: number;
  toolFailures: number;
  reasks: Reask[];
  effortSignals: EffortSignal[];
  thumbsUp: number;
  thumbsDown: number;
  decisions: ReviewDecision[];
};

/** Outcomes the review speaks in. `unclear` beats a confident guess. */
export const OUTCOMES = ['reached', 'partial', 'not_reached', 'unclear'] as const;
export type Outcome = typeof OUTCOMES[number];

/**
 * The friction a thread or approval shows. One list for both modes: code
 * names the ones it can see in the numbers, the judge may name the rest.
 */
export const FRICTION_THEMES = [
  're_asked',
  'turn_failed',
  'tool_failure',
  'too_slow',
  'too_costly',
  'wrong_effort',
  'missing_connector',
  'missing_skill',
  'missing_tool',
  'misread_intent',
  'shallow_answer',
  'wrong_or_stale_data',
  'output_format',
  'approval_overruled',
] as const;
export type FrictionTheme = typeof FRICTION_THEMES[number];

/** What each theme is called in the report. */
export const THEME_LABEL: Readonly<Record<FrictionTheme, string>> = {
  re_asked: 'People had to ask again',
  turn_failed: 'A turn failed or stopped short',
  tool_failure: 'A tool call failed',
  too_slow: 'Slower than the request needed',
  too_costly: 'Spent more than the request needed',
  wrong_effort: 'Ran at the wrong effort level',
  missing_connector: 'A connector was missing',
  missing_skill: 'A skill was missing',
  missing_tool: 'A tool was missing',
  misread_intent: 'The agent misread what was asked',
  shallow_answer: 'The answer was thinner than asked',
  wrong_or_stale_data: 'Wrong or stale data',
  output_format: 'Output in the wrong shape',
  approval_overruled: 'People overruled the recommendation',
};

function cents(microCents: number | null | undefined): number {
  return microCents ? microCents / 1_000_000 : 0;
}

function isEffort(v: string | null): v is EffortLevel {
  return v === 'quick' || v === 'standard' || v === 'deep';
}

/**
 * The facts of each assistant turn. A turn runs from the person's message it
 * answers (or the ledger's start) to the ledger's finish (or the next
 * message), and owns the tool calls made in that span.
 * @param messages - The thread, oldest first.
 * @param calls - Its model calls.
 * @param tools - Its tool calls.
 */
export function turnFacts(messages: readonly ReviewMessage[], calls: readonly ReviewModelCall[], tools: readonly ReviewToolCall[]): TurnFacts[] {
  const out: TurnFacts[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'assistant') {
      continue;
    }
    const prev = messages.slice(0, i).reverse().find(p => p.role === 'user');
    const next = messages[i + 1];
    const start = m.startedAt ?? prev?.createdAt ?? m.createdAt;
    const end = m.finishedAt ?? (m.startedAt ? null : m.createdAt);
    const endBound = end ?? next?.createdAt ?? null;
    const seconds = end ? Math.max(0, (end.getTime() - start.getTime()) / 1000) : null;
    const own = calls.filter(c => c.messageId === m.id);
    const level = own.map(c => c.effortLevel).find(isEffort) ?? null;
    const inSpan = tools.filter(t => t.createdAt >= start && (endBound === null || t.createdAt <= endBound));
    out.push({
      messageId: m.id,
      agentSlug: m.agentSlug,
      effort: level,
      model: own.length > 0 ? own[own.length - 1]!.model : null,
      thinking: level ? ENVELOPES[level].thinking === 'agent' ? 'agent' : ENVELOPES[level].thinking === 'off' ? 'off' : 'high' : null,
      seconds: seconds === null ? null : Math.round(seconds),
      cents: cents(m.microCents),
      status: m.status ?? 'complete',
      statusReason: m.statusReason,
      toolCalls: inSpan.length,
      toolFailures: inSpan.filter(t => t.failed).map(t => t.tool),
      rating: m.feedbackRating === 'up' || m.feedbackRating === 'down' ? m.feedbackRating : null,
    });
  }
  return out;
}

/**
 * The person's messages that asked again, each with the turn that shows it.
 * Content is compared here, in code, and only when the reader loaded it; the
 * structural kinds need none.
 * @param messages - The thread, oldest first.
 */
export function detectReasks(messages: readonly ReviewMessage[]): Reask[] {
  const out: Reask[] = [];
  const earlier: Array<{ id: number; grams: Set<string> }> = [];
  let lastAssistant: ReviewMessage | null = null;
  for (const m of messages) {
    if (m.role === 'assistant') {
      lastAssistant = m;
      continue;
    }
    if (m.role !== 'user') {
      continue;
    }
    const grams = m.content.trim() ? trigrams(m.content) : new Set<string>();
    if (lastAssistant && FAILED_STATUSES.has(lastAssistant.status ?? 'complete')) {
      out.push({ messageId: m.id, kind: 'after_failure' });
    } else if (lastAssistant?.feedbackRating === 'down') {
      out.push({ messageId: m.id, kind: 'after_thumbs_down' });
    } else if (grams.size > 0) {
      let best: { id: number; score: number } | null = null;
      for (const e of earlier) {
        const score = trigramJaccard(grams, e.grams);
        if (score >= REASK_SIMILARITY && (!best || score > best.score)) {
          best = { id: e.id, score };
        }
      }
      if (best) {
        out.push({ messageId: m.id, kind: 'repeat', repeats: best.id, similarity: Math.round(best.score * 100) / 100 });
      }
    }
    if (grams.size > 0) {
      earlier.push({ id: m.id, grams });
    }
  }
  return out;
}

/**
 * Where a turn's numbers say its effort level did not fit. Signals, not
 * verdicts: the judge (content mode) or the report (metadata mode) weighs them.
 * @param turns - The thread's turns.
 * @param reasks - Its re-asks.
 * @param messages - The thread, for which message followed which turn.
 */
export function effortSignals(turns: readonly TurnFacts[], reasks: readonly Reask[], messages: readonly ReviewMessage[]): EffortSignal[] {
  const out: EffortSignal[] = [];
  const reasked = new Set(reasks.map(r => r.messageId));
  const order = new Map(messages.map((m, i) => [m.id, i]));
  for (const t of turns) {
    if (!t.effort) {
      continue;
    }
    const env = ENVELOPES[t.effort];
    const up: EffortLevel = t.effort === 'quick' ? 'standard' : 'deep';
    const at = order.get(t.messageId) ?? -1;
    const nextPerson = messages.slice(at + 1).find(m => m.role === 'user');
    if (t.effort === 'quick' && nextPerson && reasked.has(nextPerson.id)) {
      out.push({ messageId: t.messageId, level: t.effort, signal: 'reasked_after_quick', suggests: 'standard' });
      continue;
    }
    if (t.effort !== 'deep' && ((t.seconds !== null && t.seconds >= env.ceilingSeconds * 0.95) || t.cents >= env.ceilingCents * 0.95)) {
      out.push({ messageId: t.messageId, level: t.effort, signal: 'hit_ceiling', suggests: up });
      continue;
    }
    if (t.seconds !== null && t.seconds > env.targetSeconds * 3) {
      out.push({ messageId: t.messageId, level: t.effort, signal: 'over_target', suggests: t.effort });
      continue;
    }
    if (t.effort === 'deep' && t.toolCalls === 0 && t.seconds !== null && t.seconds <= ENVELOPES.standard.targetSeconds) {
      out.push({ messageId: t.messageId, level: t.effort, signal: 'deep_for_light_work', suggests: 'standard' });
    }
  }
  return out;
}

/**
 * The whole thread's facts.
 * @param input - What the reader loaded.
 * @param input.messages - The thread, oldest first.
 * @param input.calls - Its model calls.
 * @param input.tools - Its tool calls.
 * @param input.decisions - Decisions taken on its proposals or asks.
 */
export function threadFacts(input: { messages: readonly ReviewMessage[]; calls: readonly ReviewModelCall[]; tools: readonly ReviewToolCall[]; decisions?: readonly ReviewDecision[] }): ThreadFacts {
  const messages = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const turns = turnFacts(messages, input.calls, input.tools);
  const reasks = detectReasks(messages);
  const first = messages[0]?.createdAt.getTime() ?? 0;
  const last = messages[messages.length - 1]?.createdAt.getTime() ?? first;
  return {
    personMessages: messages.filter(m => m.role === 'user').length,
    turns,
    spanSeconds: Math.round((last - first) / 1000),
    workSeconds: turns.reduce((s, t) => s + (t.seconds ?? 0), 0),
    cents: Math.round(turns.reduce((s, t) => s + t.cents, 0) * 100) / 100,
    failedTurns: turns.filter(t => FAILED_STATUSES.has(t.status)).length,
    toolCalls: turns.reduce((s, t) => s + t.toolCalls, 0),
    toolFailures: turns.reduce((s, t) => s + t.toolFailures.length, 0),
    reasks,
    effortSignals: effortSignals(turns, reasks, messages),
    thumbsUp: turns.filter(t => t.rating === 'up').length,
    thumbsDown: turns.filter(t => t.rating === 'down').length,
    decisions: [...(input.decisions ?? [])],
  };
}

/**
 * The outcome a thread's structure shows, with no content read: how it ended,
 * how the person rated it, how often they had to ask again. Most threads read
 * `unclear` this way, and the report says so rather than guessing.
 * @param f - The thread's facts.
 */
export function structuralOutcome(f: ThreadFacts): Outcome {
  const last = f.turns[f.turns.length - 1];
  if (!last) {
    return 'not_reached';
  }
  if (FAILED_STATUSES.has(last.status)) {
    return 'not_reached';
  }
  const lastRated = [...f.turns].reverse().find(t => t.rating !== null);
  if (lastRated?.rating === 'down' && lastRated === last) {
    return 'not_reached';
  }
  if (f.reasks.length >= 2) {
    return 'partial';
  }
  if (lastRated?.rating === 'up') {
    return 'reached';
  }
  if (f.decisions.length > 0 && f.decisions.every(d => d.decision === 'approved' || d.decision === 'done')) {
    return 'reached';
  }
  return 'unclear';
}

/**
 * The friction themes the numbers alone show. The judge may add the rest.
 * @param f - The thread's facts.
 */
export function structuralThemes(f: ThreadFacts): FrictionTheme[] {
  const out = new Set<FrictionTheme>();
  if (f.reasks.length > 0) {
    out.add('re_asked');
  }
  if (f.failedTurns > 0) {
    out.add('turn_failed');
  }
  if (f.toolFailures > 0) {
    out.add('tool_failure');
  }
  for (const s of f.effortSignals) {
    if (s.signal === 'over_target') {
      out.add('too_slow');
    } else {
      out.add('wrong_effort');
    }
  }
  if (f.decisions.some(d => d.agreed === false)) {
    out.add('approval_overruled');
  }
  return [...out];
}

/**
 * How much a thread is worth a look, from the numbers: what the review judges
 * first when it cannot judge everything, and the order "worth a look" starts from.
 * @param f - The thread's facts.
 */
export function frictionScore(f: ThreadFacts): number {
  return f.reasks.length * 3
    + f.failedTurns * 3
    + f.thumbsDown * 3
    + f.toolFailures * 2
    + f.effortSignals.length
    + f.decisions.filter(d => d.agreed === false).length * 2
    + (f.cents >= 100 ? 1 : 0);
}

/**
 * The facts as the judge reads them: numbered lines, every turn with its
 * effort, model, time and spend. Never the person's words — those go in the
 * transcript, and only when the review may read content.
 * @param f - The thread's facts.
 */
export function describeFacts(f: ThreadFacts): string {
  const lines = [
    `person messages: ${f.personMessages}; agent turns: ${f.turns.length}; span ${f.spanSeconds}s; turn time ${f.workSeconds}s; spend $${(f.cents / 100).toFixed(2)}`,
    `failed turns: ${f.failedTurns}; tool calls: ${f.toolCalls} (${f.toolFailures} failed); thumbs up ${f.thumbsUp}, down ${f.thumbsDown}`,
    `re-asks (counted in code): ${f.reasks.length}${f.reasks.length ? ` — ${f.reasks.map(r => `message ${r.messageId} ${r.kind}${r.repeats ? ` of ${r.repeats} (${r.similarity})` : ''}`).join('; ')}` : ''}`,
    ...f.turns.map(t => `turn ${t.messageId}: ${t.effort ?? 'effort unknown'} · ${t.model ?? 'model unknown'} · thinking ${t.thinking ?? 'unknown'} · ${t.seconds ?? '?'}s · $${(t.cents / 100).toFixed(2)} · ${t.status}${t.toolCalls ? ` · ${t.toolCalls} tools${t.toolFailures.length ? ` (failed: ${t.toolFailures.join(', ')})` : ''}` : ''}${t.rating ? ` · rated ${t.rating}` : ''}`),
    ...f.effortSignals.map(s => `effort signal on turn ${s.messageId}: ${s.signal} at ${s.level} (numbers point to ${s.suggests})`),
    ...f.decisions.map(d => `decision: ${d.subjectKind} ${d.subjectKey} → ${d.decision}${d.recommended ? ` (recommended ${d.recommended}${d.agreed === false ? ', overruled' : ''})` : ''}`),
  ];
  return lines.join('\n');
}
