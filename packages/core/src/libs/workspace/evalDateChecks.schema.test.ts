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

/**
 * A one-case dataset around a single check of any kind.
 * @param check - The check under test.
 */
function datasetWithCheck(check: Record<string, unknown>) {
  return { slug: 'return-checks', name: 'Return checks', agentSlug: 'event-ingestion-lead', items: [{ input: 'Ingest', checks: [check] }] };
}

describe('toolCalledWith date bounds in a manifest', () => {
  it('accepts every phrase and zone the runner resolves', () => {
    for (const onOrAfter of ['today', 'Yesterday', '3 days ago', 'in 2 weeks', 'last month', '2026-09-01']) {
      expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter })).success).toBe(true);
    }
    for (const timezone of ['utc', 'UTC', 'local', 'workspace', 'America/New_York']) {
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

  it('accepts a list of where filters, including one on absence', () => {
    const where = [{ path: 'action_input.objectType', equals: 'event-candidate' }, { path: 'action_input.fields.recurrence', present: false }];

    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'today', where })).success).toBe(true);
  });

  it('refuses a where filter that would match every call', () => {
    const result = EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'today', where: { path: 'action_input.fields.recurrence' } }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('needs equals or present');
  });

  it('refuses a fixed day that does not exist and a count past a century', () => {
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: '2026-02-30' })).success).toBe(false);
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: '99999999 years ago' })).success).toBe(false);
  });

  it('accepts a zone read from the call', () => {
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ onOrAfter: 'today', timezoneFrom: 'action_input.fields.timezone', timezone: 'workspace' })).success).toBe(true);
  });

  it('still refuses a check that names a zone and asserts nothing', () => {
    // A zone alone is not a rule.
    expect(EvalDatasetManifestSchema.safeParse(datasetWith({ timezone: 'utc' })).success).toBe(false);
  });
});

describe('toolReturned and * paths in a manifest', () => {
  it('accepts a toolReturned check with a * path', () => {
    const check = { toolReturned: { tool: 'lookup_objects', where: { path: 'type_slug', equals: 'event-candidate' }, path: '*.id', present: true } };

    expect(EvalDatasetManifestSchema.safeParse(datasetWithCheck(check)).success).toBe(true);
  });

  it('refuses a toolReturned check that asserts nothing, naming the check', () => {
    const result = EvalDatasetManifestSchema.safeParse(datasetWithCheck({ toolReturned: { tool: 'lookup_objects', path: '*.id' } }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('toolReturned needs one of equals');
  });

  it('refuses a * in a where path, which has to give one answer per call', () => {
    const inWhere = { toolCalledWith: { tool: 'propose_action', where: { path: 'action_input.fields.*.kind', equals: 'x' }, path: 'action_id', present: true } };

    expect(JSON.stringify(EvalDatasetManifestSchema.safeParse(datasetWithCheck(inWhere)).error?.issues)).toContain('a where path reads one value');
  });

  it('lets timezoneFrom use a * only where path has one for it to match', () => {
    const sameItem = { toolReturned: { tool: 'lookup_objects', path: '*.startDate', onOrAfter: 'today', timezoneFrom: '*.timezone' } };
    const noItemToMatch = { toolReturned: { tool: 'lookup_objects', path: 'startDate', onOrAfter: 'today', timezoneFrom: '*.timezone' } };

    expect(EvalDatasetManifestSchema.safeParse(datasetWithCheck(sameItem)).success).toBe(true);
    expect(JSON.stringify(EvalDatasetManifestSchema.safeParse(datasetWithCheck(noItemToMatch)).error?.issues)).toContain('timezoneFrom has more * segments than path');
  });
});
