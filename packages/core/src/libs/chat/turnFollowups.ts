/**
 * WHAT A TURN SET MOVING, TO WATCH.
 *
 * Chris, 2026-09-29, on request #201's page after a turn decided ask #221 and
 * started an engineering run: "End chat should give me something to click on
 * to watch and follow up … we already get this when an artifact is
 * generated. Use that pattern and extend the implementation." An answer that
 * started or made something that keeps going — a run, a request, a task, a
 * plan, an ask — ends with a chip for each, in the same row as the artifact
 * chips (`ArtifactChips`), with a live status and a click that opens it.
 *
 * Read from the turn's own tool steps (the ones the transcript already keeps,
 * live and after a reload), never from the model's account: a done
 * `propose_action` carries its action's result, and that result is read by
 * the one reader every surface uses for "what a run made"
 * (`libs/actions/resultLinks`). A decided ask names itself and the records it
 * was about. Pure, so what a turn is credited with is tested from fixtures.
 */

import type { ResultLink } from '@/libs/actions/resultLinks';
import { resultLinks } from '@/libs/actions/resultLinks';
import { genericRecordLinker } from '@/libs/workspace/recordHref';
import { inboxHref } from '@/services/inbox/inboxRef';

/** A tool step as the transcript keeps it. */
export type TurnToolStep = { type: string; name?: string; input?: Record<string, unknown>; output?: string; state?: string };

/** Something the turn set moving: its words, where it opens, and its preview ref. */
export type TurnFollowup = ResultLink & { ref: NonNullable<ResultLink['ref']> };

/** Keys a `propose_action` result carries that name what it made (the tool cuts the JSON at 400 chars). */
const ID_KEYS = ['workerRunId', 'objectId', 'requestId', 'createdTaskId', 'taskId', 'planId', 'askId', 'artifactId'] as const;

/**
 * The action result a done `propose_action` step reported, as far as it
 * survived the tool's cut: the JSON when it parses, else the ids read off
 * what is left.
 * @param output - The step's output.
 */
export function proposeResultOf(output: string): Record<string, unknown> | null {
  const at = output.indexOf('Result:');
  if (!/is DONE \(run #/.test(output) || at < 0) {
    return null;
  }
  const tail = output.slice(at + 7).trim();
  try {
    const parsed = JSON.parse(tail) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* cut mid-value: read the ids that made it */
  }
  const out: Record<string, unknown> = {};
  for (const key of ID_KEYS) {
    const m = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(tail);
    if (m) {
      out[key] = Number(m[1]);
    }
  }
  const type = /"objectType"\s*:\s*"([\w-]+)"/.exec(tail)?.[1];
  if (type) {
    out.objectType = type;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function words(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').trim();
}

/**
 * Every thing the turn's steps started or made, each once, in the order the
 * turn did them.
 * @param runs - The turn's steps (`message.runs`).
 */
export function turnFollowups(runs: readonly TurnToolStep[] | undefined): TurnFollowup[] {
  const out: TurnFollowup[] = [];
  const seen = new Set<string>();
  const push = (l: ResultLink) => {
    if (!l.ref) {
      return;
    }
    const key = `${l.ref.type}:${l.ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(l as TurnFollowup);
    }
  };
  for (const r of runs ?? []) {
    if (r.type !== 'tool' || r.state === 'error' || typeof r.output !== 'string') {
      continue;
    }
    if (r.name === 'propose_action') {
      const result = proposeResultOf(r.output);
      const actionId = typeof r.input?.action_id === 'string' ? r.input.action_id : '';
      if (result) {
        resultLinks({ actionId, input: (r.input?.input as Record<string, unknown> | undefined) ?? null, result }, genericRecordLinker).forEach(push);
      }
      continue;
    }
    if (r.name === 'decide_ask' || r.name === 'file_ask') {
      const ask = /^(?:Decided ask|Ask) #(\d+)/.exec(r.output)?.[1];
      if (ask) {
        push({ label: `ask #${ask}`, href: inboxHref('ask', Number(ask)), ref: { type: 'ask', id: ask } });
      }
      // What the decision was about, which is what it set moving.
      const about = /About: ([^.]+)\./.exec(r.output)?.[1] ?? '';
      for (const m of about.matchAll(/([\w-]+) #(\d+)/g)) {
        push({ label: `${words(m[1]!)} #${m[2]}`, href: genericRecordLinker({ objectType: m[1]!, id: m[2]! }), ref: { type: 'object', id: m[2]! } });
      }
    }
  }
  return out;
}
