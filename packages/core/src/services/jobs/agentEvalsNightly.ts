/**
 * `agent-evals-nightly` — the nightly pass over live agent turns (ADR 0010).
 *
 * Judges a sample of the last day's turns on the dimensions the per-turn
 * signals cannot read (grounded, arguments right, an unjustified refusal,
 * done), spread across agents and levels, and writes each verdict onto the
 * turn's row for the Live agents page. An automation carries the cadence:
 *
 * ```yaml
 * automations:
 *   - slug: agent-evals-nightly
 *     when: { schedule: '0 7 * * *' }
 *     do:   { job: agent-evals-nightly, input: { sample: 20 } }
 * ```
 *
 * Cost is one classifier call per judged turn, charged to the workspace's
 * budget under `eval.judge`: about 20 small calls a night by default. The
 * offline `agent-behaviour` eval is not run here; it needs the direct
 * Anthropic API and runs from a deployment's CI (`docs/guides/agent-evals.md`).
 */
import type { JudgeModel } from '@/services/evals/live/judge';
import { judgeLiveTurns } from '@/services/evals/live/judge';

/** At most this many turns a night, whatever the input says. */
const MAX_SAMPLE = 200;

/**
 * Judge a sample of the window's live turns.
 * @param orgId - Whose workspace.
 * @param input - `sample` (default 20, at most 200) and `days` (default 1).
 * @param deps - Test seams.
 * @param deps.model - The judge.
 * @param deps.now - The clock.
 */
export async function runAgentEvalsNightly(orgId: string, input: Record<string, unknown>, deps: { model?: JudgeModel; now?: Date } = {}): Promise<{ judged: number; unreadable: number; failed: number; since: string }> {
  const sample = Math.min(MAX_SAMPLE, Math.max(0, Math.floor(Number(input.sample ?? 20)) || 0));
  const days = Math.min(30, Math.max(1, Number(input.days ?? 1) || 1));
  const since = new Date((deps.now ?? new Date()).getTime() - days * 86_400_000);
  const out = await judgeLiveTurns(orgId, { sample, since, model: deps.model });
  return { ...out, since: since.toISOString() };
}
