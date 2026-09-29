/**
 * A voice set in an agent's YAML reaches its row: the apply's change check
 * compares it (core #918 shipped the column, and every apply after it read a
 * new `voice:` as "unchanged").
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { isAgentEqual } = await import('./applier');

describe('the apply sees a voice change', () => {
  const row = { name: 'Product manager', voice: null } as never;

  it('a voice added in YAML is a change', () => {
    expect(isAgentEqual(row, { name: 'Product manager', voice: { length: 'brief', narration: 'off', creativity: 0.2 } })).toBe(false);
  });

  it('the same voice is not', () => {
    const v = { length: 'brief', narration: 'off' };

    expect(isAgentEqual({ name: 'Product manager', voice: v } as never, { name: 'Product manager', voice: { ...v } })).toBe(true);
  });
});
