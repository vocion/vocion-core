import type { AgentRun, TraceNode } from './types';

/**
 * The turn in the order it happened.
 *
 * A reply is passages of prose with work between them: the agent reads,
 * writes a paragraph, looks something up, writes the rest. The transcript
 * used to hoist every tool call into one block at the top of the message —
 * "all the work, then all the words" — which is why it read worse than
 * OpenClaw or Claude Code, both of which show each group of calls at the
 * point in the answer where it happened. This is the fold that puts them
 * back: alternating `work` and `text` segments, each work segment carrying
 * the tool runs AND the typed trace nodes that began at that point.
 *
 * Two sources, two rules:
 *
 *   - `runs` are already chronological — the collector and the live reducer
 *     both push a tool run where it happened between the text runs — so a
 *     tool run belongs to the work segment before the next text run.
 *   - trace nodes carry `anchor`: how many text runs had started when the
 *     step began. A root node with anchor `n` goes in the work segment
 *     before text run `n`; its children follow it. A node with no anchor
 *     (a turn persisted before anchors existed) goes first, which is exactly
 *     the hoisted layout those turns were rendered with.
 *
 * A work segment with nothing in it is dropped, so a plain answer is one
 * text segment and nothing else.
 */

export type ToolRun = Extract<AgentRun, { type: 'tool' }>;

export type TurnSegment
  = | { kind: 'text'; text: string; index: number }
    | { kind: 'work'; runs: ToolRun[]; trace: TraceNode[]; index: number };

/**
 * Fold a turn's runs and trace into ordered segments.
 * @param runs - The message's runs, text and tool, in order.
 * @param trace - The message's typed trace, if any.
 */
export function segmentTurn(runs: AgentRun[], trace: TraceNode[] = []): TurnSegment[] {
  const texts = runs.filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text');
  const slots = texts.length + 1;

  // Tool runs, by the text run that follows them.
  const runSlots: ToolRun[][] = Array.from({ length: slots }, () => []);
  let seenText = 0;
  for (const run of runs) {
    if (run.type === 'text') {
      seenText += 1;
    } else if (run.type === 'tool') {
      // A card run is rendered by the card stack, not as a step.
      runSlots[seenText]!.push(run);
    }
  }

  // Trace roots by anchor (clamped into range), children with their parent.
  const traceSlots: TraceNode[][] = Array.from({ length: slots }, () => []);
  const slotOf = new Map<string, number>();
  for (const node of trace) {
    if (node.parentId) {
      continue;
    }
    const slot = Math.max(0, Math.min(slots - 1, node.anchor ?? 0));
    slotOf.set(node.id, slot);
    traceSlots[slot]!.push(node);
  }
  for (const node of trace) {
    if (!node.parentId) {
      continue;
    }
    // A child whose parent is not in the trace (should not happen) goes first.
    const slot = slotOf.get(node.parentId) ?? 0;
    traceSlots[slot]!.push(node);
  }

  const out: TurnSegment[] = [];
  for (let i = 0; i < slots; i++) {
    const workRuns = runSlots[i]!;
    const workTrace = traceSlots[i]!;
    if (workRuns.length > 0 || workTrace.length > 0) {
      out.push({ kind: 'work', runs: workRuns, trace: workTrace, index: i });
    }
    if (i < texts.length) {
      out.push({ kind: 'text', text: texts[i]!.text, index: i });
    }
  }
  return out;
}

/**
 * Which work segment is the live one while the turn streams: the last one,
 * and only when no prose follows it — once the agent has written past a
 * group of steps, that group is finished whatever the turn as a whole is
 * doing. Returns the segment's `index`, or null.
 * @param segments - The folded turn.
 */
export function liveWorkIndex(segments: TurnSegment[]): number | null {
  const last = segments[segments.length - 1];
  return last && last.kind === 'work' ? last.index : null;
}
