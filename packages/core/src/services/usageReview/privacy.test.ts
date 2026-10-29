/**
 * What the daily usage review may read, per Org: the operator's override
 * first, then the Org's own choice, then the deployment's default — on for
 * Vocion Cloud (`VOCION_USAGE_REVIEW_DEFAULT=on`), off when unset, so a
 * self-hosted install starts with it off.
 */
import { describe, expect, it } from 'vitest';
import { decideReadMode, deploymentDefault, overrideOrgs } from './privacy';

const org = (setting: boolean | null) => ({ id: 'acct-kestrel', slug: 'kestrel-capital', setting });

describe('the deployment\'s default', () => {
  it('is on for Vocion Cloud: an Org that never chose is read with content', () => {
    expect(decideReadMode(org(null), { defaultOn: 'on' })).toEqual({ mode: 'content', why: 'deployment_default' });
  });

  it('is off when unset: a self-hosted Org that never chose is read as metadata', () => {
    expect(decideReadMode(org(null), {})).toEqual({ mode: 'metadata', why: 'deployment_default' });
    expect(deploymentDefault(undefined)).toBe(false);
    expect(deploymentDefault('off')).toBe(false);
    expect(deploymentDefault('on')).toBe(true);
  });
});

describe('the Org\'s own switch', () => {
  it('switched off on Cloud, the Org is read as metadata', () => {
    expect(decideReadMode(org(false), { defaultOn: 'on' })).toEqual({ mode: 'metadata', why: 'org_setting' });
  });

  it('switched on on a self-hosted install, the Org is read with content', () => {
    expect(decideReadMode(org(true), {})).toEqual({ mode: 'content', why: 'org_setting' });
  });
});

describe('the operator\'s override', () => {
  it('reads a listed Org with content whatever it says, by id or by slug', () => {
    expect(decideReadMode(org(false), { override: 'acct-kestrel' })).toEqual({ mode: 'content', why: 'operator_override' });
    expect(decideReadMode(org(false), { override: ' northwind , kestrel-capital ' })).toEqual({ mode: 'content', why: 'operator_override' });
    expect(decideReadMode(org(false), { override: 'northwind' })).toEqual({ mode: 'metadata', why: 'org_setting' });
    expect([...overrideOrgs('a, ,b')]).toEqual(['a', 'b']);
  });
});
