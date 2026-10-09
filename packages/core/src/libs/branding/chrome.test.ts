import { describe, expect, it } from 'vitest';
import { brandChrome, leadBrandSetting } from './chrome';

/**
 * One brand per region: the top bar leads with the install's brand, the
 * footer carries the other quietly, never both — and an Org with no brand
 * never leads.
 */

describe('brandChrome', () => {
  it('Vocion Cloud (multi-Org) leads with Vocion and signs the footer with its wordmark, even for a branded Org', () => {
    expect(brandChrome({ setting: 'auto', orgsMode: 'multi', orgBranded: true, poweredBy: true })).toEqual({ lead: 'vocion', footer: 'vocion-wordmark' });
  });

  it('a single-Org branded install (self-hosted, like a client\'s own) leads with the Org, "Powered by Vocion" underneath', () => {
    expect(brandChrome({ setting: 'auto', orgsMode: 'single', orgBranded: true, poweredBy: true })).toEqual({ lead: 'org', footer: 'powered-by' });
  });

  it('white-labelled, the Org leads alone', () => {
    expect(brandChrome({ setting: 'auto', orgsMode: 'single', orgBranded: true, poweredBy: false })).toEqual({ lead: 'org', footer: null });
  });

  it('an Org with no brand never leads, whatever the setting', () => {
    expect(brandChrome({ setting: 'org', orgsMode: 'single', orgBranded: false, poweredBy: true })).toEqual({ lead: 'vocion', footer: 'vocion-wordmark' });
  });

  it('the setting overrides the default either way', () => {
    expect(brandChrome({ setting: 'vocion', orgsMode: 'single', orgBranded: true, poweredBy: true }).lead).toBe('vocion');
    expect(brandChrome({ setting: 'org', orgsMode: 'multi', orgBranded: true, poweredBy: true }).lead).toBe('org');
  });

  it('reads the setting, and anything unknown is auto', () => {
    expect(leadBrandSetting(' Org ')).toBe('org');
    expect(leadBrandSetting('vocion')).toBe('vocion');
    expect(leadBrandSetting('acme')).toBe('auto');
    expect(leadBrandSetting(undefined)).toBe('auto');
  });
});
