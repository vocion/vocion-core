import { describe, expect, it } from 'vitest';
import { restatesLabel } from './restatesLabel';

describe('restatesLabel', () => {
  it('catches the title said again, however it is dressed', () => {
    // Proposal 8017: the reasoning and the reason were both the label.
    expect(restatesLabel('Draft reply to Dana Reyes on Phase 2 call scheduling', 'Draft reply to Dana Reyes on Phase 2 call scheduling')).toBe(true);
    expect(restatesLabel('Recommended: Draft reply to Dana Reyes on Phase 2 call scheduling.', 'Draft reply to Dana Reyes on Phase 2 call scheduling')).toBe(true);
    expect(restatesLabel('draft a reply to dana reyes', 'Draft a reply to Dana Reyes!')).toBe(true);
  });

  it('lets evidence through', () => {
    expect(restatesLabel('Dana asked on Oct 8 for a call before the Oct 15 board review; nobody has answered.', 'Draft a reply to Dana Reyes')).toBe(false);
    expect(restatesLabel(undefined, 'Draft a reply')).toBe(false);
    expect(restatesLabel('', 'Draft a reply')).toBe(false);
  });
});
