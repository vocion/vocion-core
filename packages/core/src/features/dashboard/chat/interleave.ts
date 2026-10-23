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

/**
 * A line the agent wrote while it worked ("Let me check the tracker…"),
 * folded into the work it introduced. `at` is the text run it was, so it can
 * be put back between the steps that came before and after it.
 */
export type WorkNote = { text: string; at: number };

export type TurnSegment
  = | { kind: 'text'; text: string; index: number; narration?: true; answer?: true }
    | { kind: 'work'; runs: ToolRun[]; trace: TraceNode[]; index: number; notes?: WorkNote[] };

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
      const run = texts[i]!;
      out.push({ kind: 'text', text: run.text, index: i, ...(run.narration ? { narration: true as const } : {}), ...(run.answer ? { answer: true as const } : {}) });
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

/**
 * Fold the agent's working narration into the work it introduced.
 *
 * A turn reads "I'll pull the plan and the tracker" → steps → "Let me find
 * the goal" → steps → the answer. Those between-step lines are the agent
 * saying what it is about to do, not what it found, and in the message flow
 * they read as part of the answer (Chris, 2026-10-23: "are we spilling
 * thought/metadata onto the chat flow, that should be hidden behind an
 * expand/thinking chip?"). The rule is structural, never a reading of the
 * words. A passage is narration when:
 *
 *   - the model message that wrote it went on to call tools (`narration`,
 *     from the server's `passage_end`) — also when those tools draw no step
 *     of their own, which is how "Let me get the full notes…" stayed in the
 *     answer of a turn whose next call was a plumbing read; or
 *   - for a turn stored before passages were marked: the agent followed it
 *     with more work and it is not the turn's last passage.
 *
 * Narration moves into the work group after it, as a note (the group before
 * it when no work follows), and groups that only narration separated become
 * one. The last passage is the answer and stays the body, also when work
 * follows it (a card raised, a record written after the answer).
 *
 * WHILE A TURN RUNS (`live`), nothing reaches the body until it is known to
 * be the answer (Chris, 2026-10-23: "chain of thought thinking should be
 * visually scoped to the thinking line, not look like streaming text"). A
 * passage still being written is a note on the live group, its newest line
 * the turn's live line, and moves into the body the moment its message ends
 * without calling a tool (`answer`). So the body is never written and then
 * taken back.
 * @param segments - The folded turn, from {@link segmentTurn}.
 * @param opts - How the turn stands.
 * @param opts.live - The turn is still streaming.
 */
export function foldNarration(segments: TurnSegment[], opts: { live?: boolean } = {}): TurnSegment[] {
  let lastText = -1;
  segments.forEach((seg, i) => {
    if (seg.kind === 'text') {
      lastText = i;
    }
  });
  const marked = segments.some(seg => seg.kind === 'text' && (seg.narration || seg.answer));
  const isNarration = (seg: Extract<TurnSegment, { kind: 'text' }>, i: number): boolean => {
    if (seg.answer) {
      return false;
    }
    if (seg.narration) {
      return true;
    }
    // Still being written: the thinking line's until its message says it is the answer.
    if (opts.live && i === lastText) {
      return true;
    }
    // A stored turn from before passages were marked, or a passage the
    // server could not mark (a guarantee sentence appended after the loop).
    return !marked && i < lastText && segments[i + 1]?.kind === 'work';
  };
  const out: TurnSegment[] = [];
  let pending: WorkNote[] = [];
  const mergeInto = (at: number, seg: Extract<TurnSegment, { kind: 'work' }>, notes: WorkNote[]) => {
    const prev = out[at] as Extract<TurnSegment, { kind: 'work' }>;
    out[at] = { ...prev, runs: [...prev.runs, ...seg.runs], trace: [...prev.trace, ...seg.trace], notes: [...(prev.notes ?? []), ...notes, ...(seg.notes ?? [])] };
  };
  // Narration no step followed (its tools draw none, or the turn is writing
  // it now) stays where it was said: with the work before it, or as a group
  // of its own ahead of what comes next.
  const settlePending = () => {
    if (pending.length === 0) {
      return;
    }
    const prev = out[out.length - 1];
    if (prev?.kind === 'work') {
      mergeInto(out.length - 1, { kind: 'work', runs: [], trace: [], index: prev.index }, pending);
    } else {
      out.push({ kind: 'work', runs: [], trace: [], index: pending[pending.length - 1]!.at + 1, notes: pending });
    }
    pending = [];
  };
  segments.forEach((seg, i) => {
    if (seg.kind === 'text') {
      if (isNarration(seg, i)) {
        if (seg.text.trim()) {
          pending.push({ text: seg.text, at: seg.index });
        }
        return;
      }
      settlePending();
      out.push(seg);
      return;
    }
    const notes = pending;
    pending = [];
    const prev = out[out.length - 1];
    if (prev?.kind === 'work') {
      mergeInto(out.length - 1, seg, notes);
      return;
    }
    out.push(notes.length > 0 ? { ...seg, notes: [...notes, ...(seg.notes ?? [])] } : seg);
  });
  settlePending();
  return out;
}

/**
 * A work group's steps with its notes put back where they were said: a note
 * written as text run `n` goes before the first step that began after it
 * (anchor above `n`); notes said after the last step close the list.
 * @param steps - The group's root steps, in order.
 * @param notes - The group's notes.
 */
export function stepsWithNotes<T extends { anchor?: number }>(steps: readonly T[], notes: readonly WorkNote[] = []): Array<{ kind: 'note'; note: WorkNote } | { kind: 'step'; step: T }> {
  const queue = [...notes].sort((a, b) => a.at - b.at);
  const out: Array<{ kind: 'note'; note: WorkNote } | { kind: 'step'; step: T }> = [];
  for (const step of steps) {
    while (queue.length > 0 && queue[0]!.at < (step.anchor ?? 0)) {
      out.push({ kind: 'note', note: queue.shift()! });
    }
    out.push({ kind: 'step', step });
  }
  for (const note of queue) {
    out.push({ kind: 'note', note });
  }
  return out;
}
