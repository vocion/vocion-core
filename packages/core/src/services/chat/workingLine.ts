import type { AgentEvent } from '@/services/agents/types';

/**
 * THE WORKING LINE SAYS WHAT IS HAPPENING (Chris, 2026-10-06, a minute into "Looking into it…":
 * "Are there any incremental updates appropriate to share over Slack?"). The turn already names
 * its steps for the app's trace (the step labeler); the thread reads the same names, on the one
 * line that said Vocion was working, edited in place: the last few steps, done or under way.
 * Only steps a person would follow (a tool, a search, a hand-off, a draft), never the model's
 * own reasoning; at most one edit every few seconds.
 */

/** How many steps the line shows, newest last. */
export const WORKING_STEPS = 4;
/** The fewest milliseconds between two edits of the line. */
export const WORKING_EDIT_EVERY_MS = 6_000;

type Step = { label: string; done: boolean; failed: boolean };

/**
 * The line as it reads now: the working sentence, then the last steps.
 * @param head - The working sentence (`Looking into it…`).
 * @param steps - The steps so far, in order.
 */
export function workingText(head: string, steps: readonly Step[]): string {
  const shown = steps.slice(-WORKING_STEPS);
  if (shown.length === 0) {
    return head;
  }
  return [head, ...shown.map(s => `${s.failed ? '✗' : s.done ? '✓' : '…'} ${s.label}`)].join('\n');
}

/**
 * Follow a turn's steps and keep the working line in step with them. `onEvent` goes to the turn;
 * `stop` before the line is taken back, so no edit lands after the answer.
 * @param head - The working sentence.
 * @param edit - Edit the line; never throws to the caller.
 * @param opts - Seams for tests.
 * @param opts.everyMs - The fewest milliseconds between edits.
 * @param opts.now - The clock.
 */
export function followTurn(head: string, edit: (text: string) => Promise<void>, opts: { everyMs?: number; now?: () => number } = {}): { onEvent: (e: AgentEvent) => void; stop: () => Promise<void> } {
  const every = opts.everyMs ?? WORKING_EDIT_EVERY_MS;
  const now = opts.now ?? Date.now;
  const steps = new Map<string, Step>();
  let lastText = head;
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = null;
    if (stopped) {
      return;
    }
    const text = workingText(head, [...steps.values()]);
    if (text === lastText) {
      return;
    }
    lastText = text;
    lastAt = now();
    inflight = edit(text).catch(() => undefined);
  };

  const onEvent = (e: AgentEvent) => {
    if (stopped || e.type !== 'trace_node' || e.parentId || e.kind === 'reason' || !e.label?.trim()) {
      return;
    }
    // The labeler renames a step after it started; a step once finished stays finished.
    const was = steps.get(e.id);
    steps.set(e.id, { label: e.label.trim(), done: Boolean(was?.done) || e.status === 'done' || e.status === 'error', failed: Boolean(was?.failed) || e.status === 'error' });
    if (!timer) {
      timer = setTimeout(flush, Math.max(0, every - (now() - lastAt)));
    }
  };

  const stop = async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await inflight;
  };

  return { onEvent, stop };
}
