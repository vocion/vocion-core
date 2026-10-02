import { describe, expect, it } from 'vitest';
import { connectOutcomeMessage, readConnectOutcome } from './connectOutcome';

describe('the connect outcome the callback writes into the URL', () => {
  it('is absent on an ordinary visit', () => {
    expect(readConnectOutcome('')).toBeNull();
    expect(readConnectOutcome('?tab=sources')).toBeNull();
    expect(readConnectOutcome('?connect=maybe')).toBeNull();
  });

  it('reads a success with the source it was for', () => {
    expect(readConnectOutcome('?connect=ok&source=slack')).toEqual({ ok: true, source: 'slack' });
  });

  it('names the connector a login started from, when no source was involved', () => {
    expect(readConnectOutcome('?connect=ok&connector=github')).toEqual({ ok: true, source: 'github' });
  });

  it('reads a refusal by its short code', () => {
    expect(readConnectOutcome('?connect=error&reason=access_denied&source=jira'))
      .toEqual({ ok: false, reason: 'access_denied', source: 'jira' });
  });

  it('says what a person can do about each refusal, and never echoes the vendor', () => {
    expect(connectOutcomeMessage({ ok: false, reason: 'state_expired', source: 'slack' }))
      .toBe('Could not connect slack: That authorization link had expired. Start again from Connect.');
    expect(connectOutcomeMessage({ ok: false, reason: 'weird_vendor_code', source: null }))
      .toBe('Could not connect: the vendor refused (weird_vendor_code).');
    expect(connectOutcomeMessage({ ok: true, source: 'slack' }))
      .toContain('Connected slack.');
  });
});
