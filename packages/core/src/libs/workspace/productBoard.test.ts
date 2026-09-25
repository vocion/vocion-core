import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { boardLine, deriveProductBoard } from './productBoard';

const NOW = new Date('2026-09-24T12:00:00Z');

function product(id: number, meta: Record<string, unknown>): PageRow {
  return { id, title: `p${id}`, status: null, createdAt: null, meta };
}

describe('the one line a product gets', () => {
  it('leads with what is wrong, then what is waiting on the reader, then what is moving', () => {
    expect(boardLine(product(1, { health: 'down', healthCheckedAt: '2026-09-24T09:00:00Z', inFlight: 1 }), NOW)).toEqual({ tone: 'bad', line: 'Needs attention: down as of the last check (2026-09-24); 1 fix in flight.' });
    expect(boardLine(product(2, { health: 'ok', awaitingDecision: 2, inFlight: 1 }), NOW)).toEqual({ tone: 'warn', line: 'Waiting on you: 2 decisions to make; 1 change building.' });
    expect(boardLine(product(3, { health: 'ok', inFlight: 3, openRequests: 7 }), NOW)).toEqual({ tone: 'info', line: 'Building: 3 changes in flight, 7 open requests in all. No action needed from you.' });
  });

  it('calls a young release too early to judge rather than a success', () => {
    expect(boardLine(product(4, { health: 'ok', stage: 'live', lastReleaseAt: '2026-09-22T10:00:00Z', openRequests: 2 }), NOW).line).toBe('Too early to judge: released 2026-09-22; result checks are still due.');
    // A week on, it is steady, not young.
    expect(boardLine(product(5, { health: 'ok', stage: 'live', lastReleaseAt: '2026-09-10T10:00:00Z', openRequests: 2 }), NOW).line).toBe('Steady: 2 open requests, none urgent, nothing waiting on you.');
  });

  it('says quiet when there is nothing, and not live when it is not', () => {
    expect(boardLine(product(6, { health: 'ok', stage: 'live' }), NOW)).toEqual({ tone: 'ok', line: 'Quiet: nothing open, nothing waiting on you.' });
    expect(boardLine(product(7, { stage: 'idea', openRequests: 1 }), NOW).line).toBe('Not live yet: an idea with nothing built, 1 open request.');
  });

  it('writes the line and its tone on the row', () => {
    const [row] = deriveProductBoard([product(8, { health: 'degraded' })], { now: NOW });

    expect(row?.meta?.boardLine).toMatch(/^Needs attention: degraded/);
    expect(row?.meta?.boardTone).toBe('bad');
  });

  it('says what a product is built on, and what is built on it, from the board itself', () => {
    const core = { ...product(1, { slug: 'core' }), title: 'Squatch Core' };
    const send = { ...product(2, { slug: 'send', dependsOn: ['core'] }), title: 'Send' };
    const slate = { ...product(3, { slug: 'slate', dependsOn: ['core'] }), title: 'Slate' };
    const alone = { ...product(4, { slug: 'alone' }), title: 'Alone' };
    const out = deriveProductBoard([core, send, slate, alone], { now: NOW });

    expect(out[0]!.meta.dependencyLine).toBe('Send and Slate build on it');
    expect(out[1]!.meta.dependencyLine).toBe('Built on Squatch Core');
    expect(out[3]!.meta.dependencyLine).toBeUndefined();
  });
});
