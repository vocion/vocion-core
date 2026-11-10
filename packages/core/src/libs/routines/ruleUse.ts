/**
 * RULES THAT PAID OFF — which of an automation's rules its runs followed instead of asking the
 * expert, read from the `rule` steps the runs recorded (`followed_rule` in `browserLoop`). Pure and
 * client-safe: the reads (`services/routines/routineReads.ts`) hand in the runs, every surface draws
 * the result.
 */

import type { RoutineRule, RulesFollowed, RuleUse } from './types';
import type { BrowserStep } from '@/libs/browser/run';

/** How many runs a rule lists by name; the count says the rest. */
export const RULE_RUNS_SHOWN = 3;

/** A run as these read it: its row, its label, its browser run and its steps. */
export type RunSteps = { n: number; label: string; browserRunId: number | null; steps: readonly BrowserStep[] };

function key(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The rules these runs followed, in the order first followed; each run once per rule, with what the
 * rule decided there (its first `rule` step's why).
 * @param runs - The runs, in the order to list them.
 */
export function rulesFollowedIn(runs: readonly RunSteps[]): RulesFollowed[] {
  const out = new Map<string, RulesFollowed>();
  for (const run of runs) {
    const seen = new Set<string>();
    for (const s of run.steps) {
      if (!s.rule?.text) {
        continue;
      }
      const k = key(s.rule.text);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      const entry = out.get(k) ?? { text: s.rule.text, from: s.rule.from ?? null, runs: [] };
      entry.runs.push({ n: run.n, label: run.label, browserRunId: run.browserRunId, decided: s.why ?? null });
      out.set(k, entry);
    }
  }
  return [...out.values()];
}

/**
 * For each version, the rules it added (not in the version before it) that are worth a line in the
 * history: one the expert added (it has a source) or one runs have followed. Each carries how many
 * runs followed it and the newest few. A rule nothing added and nothing followed is not listed.
 * @param versions - Every version, any order, with its rules.
 * @param runs - The automation's runs, newest first.
 */
export function rulesAddedByVersion(versions: ReadonlyArray<{ n: number; rules: readonly RoutineRule[] }>, runs: readonly RunSteps[]): Map<number, RuleUse[]> {
  const followed = new Map(rulesFollowedIn(runs).map(f => [key(f.text), f]));
  const out = new Map<number, RuleUse[]>();
  const before = new Set<string>();
  for (const v of [...versions].sort((a, b) => a.n - b.n)) {
    const added: RuleUse[] = [];
    for (const r of v.rules) {
      const k = key(r.text);
      if (before.has(k)) {
        continue;
      }
      before.add(k);
      const f = followed.get(k);
      if (!r.from && !f) {
        continue;
      }
      const recent = (f?.runs ?? []).filter((x): x is typeof x & { browserRunId: number } => typeof x.browserRunId === 'number').slice(0, RULE_RUNS_SHOWN);
      added.push({ text: r.text, from: r.from ?? null, runs: f?.runs.length ?? 0, recent: recent.map(x => ({ browserRunId: x.browserRunId, label: x.label, decided: x.decided })) });
    }
    if (added.length > 0) {
      out.set(v.n, added);
    }
  }
  return out;
}

/**
 * Whose rule, in a few words: "Marcus's answer", "Marcus", or nothing when no one is named.
 * @param from - Where the rule came from.
 * @param from.by - Who said it (a name).
 * @param from.askId - The decision they answered.
 */
export function ruleSourceWords(from: { by: string | null; askId: number | null } | null | undefined): string | null {
  const by = from?.by?.trim() ?? '';
  const first = by.includes('@') ? by.split('@')[0]! : by.split(/\s+/)[0] ?? '';
  if (!first) {
    return from?.askId ? 'The expert’s answer' : null;
  }
  return from?.askId ? `${first}’s answer` : first;
}
