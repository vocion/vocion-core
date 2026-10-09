import type { ConnectCandidate } from './systemsPlan';
import { describe, expect, it } from 'vitest';
import { unlockLine } from './systemsPlan';

function candidate(unlocks: ConnectCandidate['unlocks']): ConnectCandidate {
  return { connector: 'github', name: 'GitHub', score: 60, recommended: true, evidence: [{ kind: 'named' }], method: { kind: 'page', href: '/dashboard/connectors?add=github' }, unlocks };
}

describe('what a connected system unlocks, in one line', () => {
  it('names a feature once when it is called what its app is called', () => {
    // 2026-10-09: "Unlocks Software Factory: Software factory".
    expect(unlockLine(candidate([{ app: 'software-factory', appName: 'Software Factory', href: '/dashboard/apps/software-factory', added: true, features: ['Software factory'] }]), 'connected')).toBe('Software Factory can read it');
  });

  it('keeps the features that say something more', () => {
    expect(unlockLine(candidate([{ app: 'gtm', appName: 'GTM', href: '/dashboard/apps/gtm', added: true, features: ['GTM', 'Pipeline review'] }]), 'connected')).toBe('GTM: Pipeline review');
  });

  it('says what happened instead, when it did not connect', () => {
    expect(unlockLine(candidate([]), 'later')).toBe('Put off for later');
    expect(unlockLine(candidate([]), 'skipped')).toBe('Skipped');
  });
});
