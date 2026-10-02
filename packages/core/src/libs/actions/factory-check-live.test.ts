import { describe, expect, it } from 'vitest';
import { factoryCheckLiveAgainAction } from './factory-check-live';

describe('a person asks for the live check again (FE-314, 2026-10-02)', () => {
  it('is its own action, with Undo', () => {
    expect(factoryCheckLiveAgainAction.id).toBe('factory.check_live_again');
    expect(typeof factoryCheckLiveAgainAction.undo).toBe('function');
  });

  it('is a person\'s call: an agent asking for round after round is refused, with why', async () => {
    expect(await factoryCheckLiveAgainAction.precheck?.({ orgId: 'org_x', invokedBy: 'agent:change-reviewer' } as never, { releaseId: 3, reason: 'x' })).toMatch(/a person's call/);
    expect(await factoryCheckLiveAgainAction.precheck?.({ orgId: 'org_x', invokedBy: 'user_fictional' } as never, { releaseId: 3, reason: 'x' })).toBeUndefined();
  });
});
