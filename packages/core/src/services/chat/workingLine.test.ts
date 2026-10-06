import type { AgentEvent } from '@/services/agents/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followTurn, workingText } from './workingLine';

/** The working line names the turn's steps as they happen (Chris, 2026-10-06). */

const step = (id: string, label: string, status: 'start' | 'done' | 'error', over: Partial<AgentEvent & { type: 'trace_node' }> = {}) =>
  ({ type: 'trace_node', id, actor: { kind: 'agent', slug: 'product-manager' }, kind: 'tool', status, label, ...over }) as unknown as AgentEvent;

beforeEach(() => vi.useFakeTimers({ now: 0 }));

afterEach(() => vi.useRealTimers());

describe('the working line', () => {
  it('reads the last few steps, done or under way', () => {
    expect(workingText('Looking into it…', [])).toBe('Looking into it…');
    expect(workingText('Looking into it…', [
      { label: 'Read FE-133', done: true, failed: false },
      { label: 'Checked the plan', done: true, failed: true },
      { label: 'Writing the contract', done: false, failed: false },
    ])).toBe('Looking into it…\n✓ Read FE-133\n✗ Checked the plan\n… Writing the contract');
  });

  it('edits the line at most once a window, with the steps a person follows, and never after it stops', async () => {
    const edits: string[] = [];
    const turn = followTurn('Looking into it…', async (t) => {
      edits.push(t);
    }, { everyMs: 6_000 });

    turn.onEvent(step('a', 'Reading FE-133', 'start'));
    turn.onEvent(step('r', 'Thinking it over', 'start', { kind: 'reason' }));
    turn.onEvent(step('c', 'a child step', 'start', { parentId: 'a' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(edits).toEqual(['Looking into it…\n… Reading FE-133']);

    turn.onEvent(step('a', 'Read FE-133', 'done'));
    turn.onEvent(step('b', 'Writing the plan', 'start'));
    // A late rename of a finished step keeps it finished.
    turn.onEvent(step('a', 'Read FE-133 and its plan', 'start'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(edits).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(edits.at(-1)).toBe('Looking into it…\n✓ Read FE-133 and its plan\n… Writing the plan');

    turn.onEvent(step('b', 'Wrote the plan', 'done'));
    await turn.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(edits).toHaveLength(2);
  });
});
