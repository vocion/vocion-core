/**
 * The manifest side of relative date checks. A phrase or zone the runner
 * cannot resolve has to be refused when the workspace is applied; let through,
 * it would throw in the middle of scoring a live run, or worse, be read as
 * some day nobody meant.
 */

import { describe, expect, it } from 'vitest';
import { EvalDatasetManifestSchema } from './schemas';

/**
 * A one-case dataset around a single argument check.
 * @param condition - The `toolCalledWith` body under test.
 */
function datasetWith(condition: Record<string, unknown>) {
  return {
    slug: 'date-checks',
    name: 'Date checks',
    agentSlug: 'event-ingestion-lead',
    items: [{
      input: 'Ingest https://example.org/events',
      checks: [{ toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', ...condition } }],
    }],
  };
}

describe('toolCalledWith date bounds in a manifest', () => {
  it('accepts every phrase and zone the runner resolves', () => {
    for (const onOrAfter of ['today', 'Yesterday', '3 days ago', 'in 2 weeks', 'last month', '2026-09-01']) {
      expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter })).success).toBe(true);
    }
    for (const timezone of ['utc', 'UTC', 'local', 'America/New_York']) {
      expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'today', timezone })).success).toBe(true);
    }
  });

  it('counts a date bound as something to assert on its own', () => {
    // Without this, a check with only onOrBefore would be refused as
    // asserting nothing.
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrBefore: 'next year' })).success).toBe(true);
  });

  it('refuses a phrase the runner cannot resolve, naming the field', () => {
    const result = EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'next friday' }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('onOrAfter must be');
  });

  it('refuses a bad onOrBefore the same way', () => {
    const result = EvalDatasetManifestSchema.safeParse(datasetWith({ onOrBefore: 'a week from now' }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('onOrBefore must be');
  });

  it('refuses a zone that is not a zone', () => {
    // An invalid IANA name would throw from Intl on every case of every run.
    const result = EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'today', timezone: 'Vermont' }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('timezone must be');
  });

  it('still refuses a check that names a zone and asserts nothing', () => {
    // A zone alone is not a rule.
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ timezone: 'utc' })).success).toBe(false);
  });
});
