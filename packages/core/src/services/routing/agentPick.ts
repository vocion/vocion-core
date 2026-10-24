/**
 * WHO ANSWERS, PICKED BY JEV (ADR 0006, phase 2). The workspace router
 * (`services/agents/router.ts` `routeFirstTurn`) chooses which agent answers
 * a first message nobody addressed; its last structural step is a read of the
 * message against the roster. With a Jev (TypeSafe) API key, Jev is asked the
 * same question as a typed choice, beside that read: the same seats (only the
 * ones that take unaddressed messages), described the same way
 * (`routeRead.ts` `seatLines`), and `none` for "the lead should answer".
 *
 * Its pick is used only when it names a seat on the roster at Jev's own
 * confidence bar (`VOCION_JEV_MIN_CONFIDENCE`); otherwise the model read
 * decides, exactly as without a key. A named agent, a follow-up and a record's
 * page owner are decided before this step and never reach Jev. The pick only
 * chooses who answers: that seat's tools, gates and approvals apply as always.
 *
 * Null means no key: the router behaves exactly as before. Never throws.
 */

import type { JevAgentPick, RoutableAgent } from '@/services/agents/router';
import type { JevAnswer, JevDeps, JevFailure, JevQuestion, JevSettings } from './jev';
import type { KeyScope } from './jevKey';
import process from 'node:process';
import { jevBreakerOpen, noteJevOutcome, chatTimeoutMs } from './agentRoute';
import { decide, isJevFailure, jevEndpoint, jevSettings, NONE } from './jev';

export type AgentPickDeps = {
  resolveKey?: (orgId: string) => Promise<{ key: string; scope: KeyScope } | null>;
  decide?: (key: string, q: JevQuestion, settings: Pick<JevSettings, 'model' | 'timeoutMs' | 'baseUrl'>, deps?: JevDeps) => Promise<JevAnswer | JevFailure>;
  settings?: JevSettings;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

/**
 * Ask Jev which seat answers.
 * @param input - The message and the roster the router would read.
 * @param input.orgId - The workspace.
 * @param input.message - The first message.
 * @param input.agents - The seats that take unaddressed messages, with what they own.
 * @param input.leadSlug - The workspace lead.
 * @param deps - Seams for tests.
 */
export async function pickAgent(input: { orgId: string; message: string; agents: RoutableAgent[]; leadSlug: string }, deps: AgentPickDeps = {}): Promise<JevAgentPick | null> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  let resolved: { key: string; scope: KeyScope } | null;
  try {
    resolved = await (deps.resolveKey ?? (async (orgId: string) => (await import('./jevKey')).resolveJevKey(orgId)))(input.orgId);
  } catch {
    return null;
  }
  if (!resolved) {
    return null;
  }
  const settings = deps.settings ?? jevSettings(env);
  const endpoint = jevEndpoint(resolved.key, settings);
  const seats = input.agents.filter(a => a.slug !== NONE);
  const base = { selector: 'model', asked: false, candidates: seats.length, choice: null as string | null, confidence: null as number | null, jevModel: null as string | null, latencyMs: null as number | null, keyScope: resolved.scope, provider: endpoint.provider, fallback: null as string | null };
  const skip = (detail: typeof base, why: string): JevAgentPick => ({ chosen: null, confidence: 0, reason: '', detail: { ...detail, fallback: why } });
  if (seats.length < 2) {
    return skip(base, 'fewer than two seats to choose between');
  }
  if (jevBreakerOpen(input.orgId, now())) {
    return skip(base, 'Jev failed three times in a row; skipped for a minute');
  }
  const { seatLines } = await import('@/services/agents/routeRead');
  const candidates = seats.map(a => ({ id: a.slug, text: seatLines(a, input.leadSlug) }));
  const timeoutMs = Math.min(chatTimeoutMs(env), settings.timeoutMs);
  const answer = await (deps.decide ?? decide)(resolved.key, { state: { message: input.message.slice(0, 2000) }, candidates, purpose: 'agent' }, { ...settings, timeoutMs })
    .catch((): JevFailure => ({ failed: true, kind: 'network', reason: 'Jev could not be reached', latencyMs: 0 }));
  if (isJevFailure(answer)) {
    noteJevOutcome(input.orgId, false, now());
    return skip({ ...base, asked: true, jevModel: endpoint.model, latencyMs: answer.latencyMs }, answer.reason);
  }
  noteJevOutcome(input.orgId, true, now());
  const detail = { ...base, asked: true, choice: answer.choice, confidence: answer.confidence, jevModel: answer.model ?? endpoint.model, latencyMs: answer.latencyMs };
  if (answer.choice === NONE) {
    return skip(detail, 'Jev found no seat owns this; the model read decides');
  }
  if (!seats.some(a => a.slug === answer.choice)) {
    return skip(detail, `Jev picked "${String(answer.choice).slice(0, 40)}", which is not on the roster`);
  }
  if (answer.confidence === null || answer.confidence < settings.minConfidence) {
    return skip(detail, `Jev's confidence ${answer.confidence === null ? 'was missing' : answer.confidence.toFixed(2)} is below ${settings.minConfidence}`);
  }
  return {
    chosen: answer.choice,
    confidence: answer.confidence,
    reason: `Jev chose ${answer.choice} (confidence ${answer.confidence.toFixed(2)}).`,
    detail: { ...detail, selector: 'jev' },
  };
}
