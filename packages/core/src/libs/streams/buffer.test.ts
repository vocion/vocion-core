import { describe, expect, it } from 'vitest';

describe('whether a conversation has a running turn', () => {
  it('is true while a turn for it is open, and false once it closes or when none was started', async () => {
    const { answeringIn, openStream } = await import('./buffer');
    const s = openStream('answering-1', { orgId: 'org_a', userId: 'u1' }, 77);

    expect(answeringIn('org_a', 77)).toBe(true);
    expect(answeringIn('org_b', 77)).toBe(false);
    expect(answeringIn('org_a', 78)).toBe(false);

    s.close();

    expect(answeringIn('org_a', 77)).toBe(false);
  });
});

describe('whether the person started another turn', () => {
  it('is true only for a turn in the same conversation opened after the moment asked about', async () => {
    const { newerTurnIn, openStream } = await import('./buffer');
    const since = Date.now() - 1;

    expect(newerTurnIn('org_n', 91, since)).toBe(false);

    openStream('newer-1', { orgId: 'org_n', userId: 'u1' }, 91);

    expect(newerTurnIn('org_n', 91, since)).toBe(true);
    expect(newerTurnIn('org_n', 92, since)).toBe(false);
    expect(newerTurnIn('org_other', 91, since)).toBe(false);
    expect(newerTurnIn('org_n', 91, Date.now() + 1)).toBe(false);
  });
});
