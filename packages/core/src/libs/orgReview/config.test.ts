import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_REVIEW_CRON, OrgReviewConfigSchema, resolveOrgReviewConfig } from './config';

describe('the org review a workspace runs with', () => {
  it('is weekly with the shipped thresholds when the workspace said nothing', () => {
    expect(resolveOrgReviewConfig(null)).toEqual({ enabled: true, schedule: DEFAULT_ORG_REVIEW_CRON, idleDays: 14, staleRuleDays: 60, maxProposals: 5 });
  });

  it('is off for a personal workspace unless it opted in', () => {
    expect(resolveOrgReviewConfig(null, 'personal').enabled).toBe(false);
    expect(resolveOrgReviewConfig({ enabled: true }, 'personal').enabled).toBe(true);
  });

  it('keeps what was authored and defaults the rest', () => {
    expect(resolveOrgReviewConfig({ schedule: '0 9 * * 2', idleDays: 30 })).toMatchObject({ schedule: '0 9 * * 2', idleDays: 30, staleRuleDays: 60, maxProposals: 5 });
  });

  it('reads a stored value that no longer parses as "said nothing" rather than failing the review', () => {
    expect(resolveOrgReviewConfig({ idleDays: -3 } as never)).toMatchObject({ idleDays: 14, enabled: true });
  });

  it('refuses a cron that is not five fields and a key it does not know', () => {
    expect(OrgReviewConfigSchema.safeParse({ schedule: 'weekly' }).success).toBe(false);
    expect(OrgReviewConfigSchema.safeParse({ cadence: 'weekly' }).success).toBe(false);
  });
});
