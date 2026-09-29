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
