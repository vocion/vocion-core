/**
 * THE PROGRESS HOOK — where a long step has got to, said on its own line.
 *
 * On 2026-10-29 an SEO turn showed one line, "Checked what Ahrefs can do ·
 * 11 steps · 1m 2s", for about ninety seconds; the person switched tabs. A
 * step that loops over keywords or pages knows exactly where it is — 4 of 12
 * — and a person watching should too: "Reading Google's results for 12
 * keywords (4 of 12)".
 *
 * A tool asks for a reporter for its own step and tells it what it knows:
 *
 *   const progress = stepProgress(ctx.emit, 'keyword_cluster');
 *   progress.count(done, total);           // "(4 of 12)" on the step's line
 *   progress.note('laying the slides out'); // a stage, said once
 *   progress.pulse('step 7 · Clicked “Sign in”'); // open-ended, throttled
 *
 * Each report becomes a `step_progress` event, which the chat folds onto the
 * step already running under that tool (`traceReducer.ts`
 * `noteToolProgress`): no new row, no model call, and when the step lands the
 * note goes with it and the group folds to its usual summary.
 *
 * COUNTS ARE THROTTLED. A loop of 40 quick reads would otherwise rewrite the
 * line forty times; a count goes out first, then at most once every
 * {@link PROGRESS_EVERY_MS}, so a long step's line moves every 15–20 seconds
 * and a short one's barely at all. A stage note is a change of what the step
 * is doing and goes out at once; a repeat of either is dropped.
 *
 * Only report from a loop that REALLY runs: a note is a fact about the work,
 * never an animation.
 */

/** How often a count may move the line. */
const PROGRESS_EVERY_MS = 15_000;

/** The one event a reporter sends (`AgentEvent` `step_progress`). */
type StepProgressEvent = { type: 'step_progress'; tool: string; note: string };

type StepProgress = {
  /** Where a loop has got to: `done` of `total`. Throttled. */
  count: (done: number, total: number) => void;
  /** What the step is doing now, in a few plain words. Sent at once, repeats dropped. */
  note: (text: string) => void;
  /** Where open-ended work has got to, with no total to count against ("step 7 · Clicked “Sign in”"). Throttled like a count. */
  pulse: (text: string) => void;
};

/**
 * "4 of 12" — the count a step's line ends with.
 * @param done - How many are done (or under way).
 * @param total - How many there are.
 */
function countNote(done: number, total: number): string {
  return `${Math.max(0, Math.min(done, total))} of ${total}`;
}

/**
 * A reporter for one step.
 * @param emit - The turn's emit (`RuntimeContext.emit`).
 * @param tool - The tool name the step runs under.
 * @param opts - Test seams.
 * @param opts.everyMs - The count throttle (default {@link PROGRESS_EVERY_MS}).
 * @param opts.now - The clock.
 */
export function stepProgress(emit: (event: StepProgressEvent) => void, tool: string, opts: { everyMs?: number; now?: () => number } = {}): StepProgress {
  const everyMs = opts.everyMs ?? PROGRESS_EVERY_MS;
  const now = opts.now ?? Date.now;
  let last: string | null = null;
  let lastCountAt: number | null = null;
  const send = (note: string) => {
    last = note;
    try {
      emit({ type: 'step_progress', tool, note });
    } catch {
      // A note is advisory: a closed stream never fails the work it describes.
    }
  };
  const throttled = (note: string) => {
    const at = now();
    if (!note || note === last || (lastCountAt !== null && at - lastCountAt < everyMs)) {
      return;
    }
    lastCountAt = at;
    send(note);
  };
  return {
    count(done, total) {
      if (Number.isFinite(done) && Number.isFinite(total) && total > 1) {
        throttled(countNote(done, total));
      }
    },
    pulse(text) {
      throttled(text.replace(/\s+/g, ' ').trim().slice(0, 120));
    },
    note(text) {
      const note = text.trim();
      if (note && note !== last) {
        send(note);
      }
    },
  };
}
