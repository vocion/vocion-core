/**
 * Trust ladder decisions against PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { trustRuleSchema } = await import('@/models/Schema');
const { trustDecision } = await import('@/services/TrustService');

const ORG = 'org_trust';

beforeEach(async () => {
  await db.delete(trustRuleSchema);
});

afterAll(async () => {
  await db.delete(trustRuleSchema);
});

describe('trustDecision', () => {
  it('defaults to review: no rule → not auto', async () => {
    expect(await trustDecision(ORG, 'hubspot.update', 0.99)).toEqual({ auto: false, reason: 'no-rule' });
  });

  it('disabled rules never auto-execute', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'false' });

    expect(await trustDecision(ORG, 'hubspot.update', 0.99)).toEqual({ auto: false, reason: 'disabled' });
  });

  it('enabled rule + confidence at/above threshold → auto', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' });

    expect(await trustDecision(ORG, 'hubspot.update', 0.95)).toEqual({ auto: true, threshold: 0.9 });
    expect(await trustDecision(ORG, 'hubspot.update', 0.9)).toEqual({ auto: true, threshold: 0.9 });
  });

  it('below threshold or missing confidence → review', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' });

    expect(await trustDecision(ORG, 'hubspot.update', 0.89)).toEqual({ auto: false, reason: 'below-threshold' });
    expect(await trustDecision(ORG, 'hubspot.update', undefined)).toEqual({ auto: false, reason: 'no-confidence' });
  });
});
