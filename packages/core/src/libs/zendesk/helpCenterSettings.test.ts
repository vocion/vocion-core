/**
 * The Help Center settings are what stands between a pasted host and a server
 * that calls it with no credential and no human watching, so these tests pin
 * the rules a wrong edit would quietly relax: what a host may be, which host
 * wins, and that a source saved before these settings existed still works.
 */
import { describe, expect, it } from 'vitest';
import { zendeskConfigSchema } from '@/libs/sources/zendesk';
import { helpCenterOriginFrom, helpCenterSettingsFrom, resolveHelpCenterTarget } from './helpCenterSettings';

describe('zendesk source config', () => {
  it('still accepts the config every existing source was saved with', () => {
    expect(zendeskConfigSchema.safeParse({}).success).toBe(true);
    expect(zendeskConfigSchema.safeParse({ helpCenter: {} }).success).toBe(true);
  });

  it('accepts a custom domain and a locale', () => {
    const parsed = zendeskConfigSchema.safeParse({ helpCenter: { host: 'https://help.example.com', locale: 'pt-br' } });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['http, not https', 'http://help.example.com'],
    ['a path', 'https://help.example.com/hc/en-us'],
    ['credentials in the URL', 'https://user:secret@help.example.com'],
    ['a query', 'https://help.example.com?x=1'],
    ['an empty fragment', 'https://help.example.com/#'],
    ['a port', 'https://help.example.com:8443'],
    ['localhost', 'https://localhost'],
    ['a private address', 'https://10.0.0.1'],
    ['a public IPv4 address, which would skip the DNS check', 'https://8.8.8.8'],
    ['an IPv4 address in hex form', 'https://0x08.0x08.0x08.0x08'],
    ['an IPv4 address as one decimal number', 'https://134744072'],
    ['a short IPv4 form', 'https://8.8.2056'],
    ['a bracketed IPv6 address', 'https://[2606:4700::1111]'],
    ['a bracketed IPv4-mapped IPv6 address', 'https://[::ffff:8.8.8.8]'],
    ['a trailing dot', 'https://help.example.com.'],
    ['no scheme', 'help.example.com'],
    ['a space', 'https://help.example.com /x'],
    ['an empty string', ''],
  ])('refuses a host with %s', (_label, host) => {
    expect(zendeskConfigSchema.safeParse({ helpCenter: { host } }).success).toBe(false);
  });

  it.each(['en_us', 'english', '../x', 'en-us/../../admin', 'e', 'en-'])('refuses the locale %s, which could not sit safely in a path', (locale) => {
    expect(zendeskConfigSchema.safeParse({ helpCenter: { locale } }).success).toBe(false);
  });
});

describe('helpCenterOriginFrom', () => {
  it('drops the trailing slash and lowercases the host', () => {
    expect(helpCenterOriginFrom('https://Help.Example.com/')).toBe('https://help.example.com');
  });
});

describe('helpCenterSettingsFrom', () => {
  it('reads a source saved with no settings as empty settings', () => {
    expect(helpCenterSettingsFrom({})).toEqual({ ok: true, settings: {} });
    expect(helpCenterSettingsFrom(null)).toEqual({ ok: true, settings: {} });
  });

  it('says what is wrong with saved settings instead of ignoring them', () => {
    const result = helpCenterSettingsFrom({ helpCenter: { host: 'http://help.example.com' } });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('https origin');
  });
});

describe('resolveHelpCenterTarget', () => {
  it('uses the configured host over the credential subdomain, normalized', () => {
    const result = resolveHelpCenterTarget({ host: 'https://help.example.com/', locale: 'EN-GB' }, 'acme');

    expect(result).toEqual({ ok: true, target: { origin: 'https://help.example.com', locale: 'en-gb' } });
  });

  it('defaults to the credential subdomain and en-us when the source names neither', () => {
    const result = resolveHelpCenterTarget({}, 'acme');

    expect(result).toEqual({ ok: true, target: { origin: 'https://acme.zendesk.com', locale: 'en-us' } });
  });

  it('says it is not configured, never guesses a host, when there is no host and no credential', () => {
    const result = resolveHelpCenterTarget({ locale: 'en-us' }, null);

    expect(result).toMatchObject({ ok: false, error: 'help_center_not_configured' });
  });
});

describe('admin-fix wording', () => {
  const NOTE = 'Tell the user the Help Center could not be read. A workspace admin must fix';

  it('tells the model to report a bad host and names the setting an admin must fix, not a step the model cannot take', () => {
    const result = helpCenterSettingsFrom({ helpCenter: { host: 'http://x' } });

    expect(!result.ok && result.message).toContain(`${NOTE} helpCenter.host on the zendesk source.`);
    expect(!result.ok && result.message).not.toContain('Fix ');
  });

  it('names both settings when the host and the locale are both bad', () => {
    const result = helpCenterSettingsFrom({ helpCenter: { host: 'http://x', locale: 'english' } });

    expect(!result.ok && result.message).toContain(`${NOTE} helpCenter.host and helpCenter.locale on the zendesk source.`);
  });

  it.each(['text', 7, ['host'], true])('names the whole helpCenter block, not "helpCenter.", and ends each sentence with a period, when it is %j', (block) => {
    const result = helpCenterSettingsFrom({ helpCenter: block });

    expect(!result.ok && result.message).toContain('A workspace admin must fix helpCenter on the zendesk source.');
    expect(!result.ok && result.message).not.toContain('helpCenter.');
    expect(!result.ok && result.message).toMatch(/invalid: [^.]*\. Tell the user/);
  });

  it('uses the same wording when not configured', () => {
    const result = resolveHelpCenterTarget({}, null);

    expect(!result.ok && result.message).toContain('Tell the user the Help Center could not be read. A workspace admin must set helpCenter.host');
  });
});
