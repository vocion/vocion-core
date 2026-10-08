import { describe, expect, it } from 'vitest';
import { CONFLUENCE_READ_SCOPES, JIRA_READ_SCOPES } from '@/libs/atlassian/oauth';
import { APOLLO_LOGIN_SCOPES } from '@/libs/connect/providers/apollo';
import { BOX_LOGIN_SCOPES } from '@/libs/connect/providers/box';
import { DROPBOX_LOGIN_SCOPES } from '@/libs/connect/providers/dropbox';
import { GOOGLE_LOGIN_SCOPES } from '@/libs/connect/providers/google';
import { GUSTO_LOGIN_ACCESS } from '@/libs/connect/providers/gusto';
import { HUBSPOT_LOGIN_SCOPES } from '@/libs/connect/providers/hubspot';
import { POSTHOG_LOGIN_SCOPES } from '@/libs/connect/providers/posthog';
import { SLACK_SOURCE_SCOPES } from '@/libs/connect/providers/slack';
import { XERO_LOGIN_SCOPES } from '@/libs/connect/providers/xero';
import { ZOOM_LOGIN_SCOPES } from '@/libs/connect/providers/zoom';
import { providerForConnector } from '@/libs/connect/registry';
import { getConnector } from '@/libs/sources/registry';
import { accessForDisplay, howToConnectFor, listPlatforms, loginIsEnough, platformForConnectorSlug } from './registry';

const connectorPlatforms = listPlatforms().filter(platform => platform.connectorSlugs.length > 0);
const connectorSlugs = connectorPlatforms.flatMap(platform => platform.connectorSlugs);

describe('howToConnect declarations', () => {
  it('every platform that backs a connector says how to connect it', () => {
    const missing = connectorPlatforms.filter(platform => !platform.howToConnect).map(platform => platform.id);

    expect(missing).toEqual([]);
  });

  it('a connector has a login exactly when the connect registry has a provider for it, and it is the same provider', () => {
    for (const slug of connectorSlugs) {
      const provider = providerForConnector(slug);
      const login = howToConnectFor(slug)?.login;

      expect(login?.provider, slug).toBe(provider?.id);
    }
  });

  it('every login says which settings the source still needs after it, and each is a real setting of the connector', () => {
    for (const slug of connectorSlugs) {
      const login = howToConnectFor(slug)?.login;
      if (!login) {
        continue;
      }
      const shape = (getConnector(slug)?.configSchema as unknown as { shape: Record<string, unknown> }).shape;

      expect(Array.isArray(login.settingsAfterLogin), slug).toBe(true);

      for (const setting of login.settingsAfterLogin) {
        expect(Object.keys(shape), `${slug}.${setting.key}`).toContain(setting.key);
        expect(setting.label.length, `${slug}.${setting.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('login alone is enough where every setting has a default, and not where the source must be pointed somewhere', () => {
    for (const slug of ['slack', 'notion', 'hubspot', 'zoom', 'apollo', 'gmail', 'drive', 'google-calendar', 'quickbooks', 'xero', 'gusto', 'dropbox', 'box']) {
      expect(loginIsEnough(slug), slug).toBe(true);
    }
    for (const slug of ['github', 'jira', 'ga4', 'posthog', 'confluence']) {
      expect(loginIsEnough(slug), slug).toBe(false);
    }
  });

  it('where login alone is enough, the source the login makes on its own has every setting it needs', () => {
    for (const slug of connectorSlugs.filter(loginIsEnough)) {
      const parsed = (getConnector(slug)?.configSchema as unknown as { safeParse: (value: unknown) => { success: boolean } }).safeParse({});

      expect(parsed.success, slug).toBe(true);
    }
  });

  it('each Google connector logs in for its own scope only, and Google Ads, which also needs a developer token, has no login', () => {
    for (const slug of ['gmail', 'drive', 'google-calendar', 'ga4']) {
      expect(howToConnectFor(slug)?.login?.access, slug).toEqual([...GOOGLE_LOGIN_SCOPES[slug]!]);
    }

    expect(howToConnectFor('google-ads')?.login).toBeUndefined();
    expect(howToConnectFor('google-ads')?.paste?.credential).toBe('OAuth client and refresh token');
  });

  it('a connector with nothing to paste declares no paste and no inputs, so the form offers its login alone', () => {
    const quickbooks = platformForConnectorSlug('quickbooks');

    expect(howToConnectFor('quickbooks')?.paste).toBeUndefined();
    expect(howToConnectFor('quickbooks')?.login?.provider).toBe('quickbooks');
    expect(quickbooks?.fields).toEqual([]);

    // Every connector that does declare a paste has something to paste into.
    for (const platform of connectorPlatforms.filter(p => p.howToConnect?.paste)) {
      expect(platform.fields.length, platform.id).toBeGreaterThan(0);
    }
    for (const platform of connectorPlatforms.filter(p => !p.howToConnect?.paste)) {
      expect(platform.fields, platform.id).toEqual([]);
    }
  });

  it('only documented https URLs are offered for making a credential by hand', () => {
    for (const platform of connectorPlatforms) {
      const url = platform.howToConnect?.paste?.getItAt?.url;
      if (url) {
        expect(url.startsWith('https://'), platform.id).toBe(true);
      }
    }
  });

  it('login access matches the scopes the provider really asks for', () => {
    expect(howToConnectFor('jira')?.login?.access).toEqual([...JIRA_READ_SCOPES]);
    expect(howToConnectFor('slack')?.login?.access).toEqual([...SLACK_SOURCE_SCOPES]);
    expect(howToConnectFor('hubspot')?.login?.access).toEqual([...HUBSPOT_LOGIN_SCOPES]);
    expect(howToConnectFor('posthog')?.login?.access).toEqual([...POSTHOG_LOGIN_SCOPES]);
    expect(howToConnectFor('apollo')?.login?.access).toEqual([...APOLLO_LOGIN_SCOPES]);
    expect(howToConnectFor('zoom')?.login?.access).toEqual([...ZOOM_LOGIN_SCOPES]);
    expect(howToConnectFor('xero')?.login?.access).toEqual([...XERO_LOGIN_SCOPES]);
    expect(howToConnectFor('gusto')?.login?.access).toEqual([...GUSTO_LOGIN_ACCESS]);
    expect(howToConnectFor('confluence')?.login?.access).toEqual([...CONFLUENCE_READ_SCOPES]);
    expect(howToConnectFor('dropbox')?.login?.access).toEqual([...DROPBOX_LOGIN_SCOPES]);
    expect(howToConnectFor('box')?.login?.access).toEqual([...BOX_LOGIN_SCOPES]);
  });

  it('a Google login shows its scope by name, not as a URL, and other vendors\' scopes show as they are', () => {
    expect(accessForDisplay(howToConnectFor('gmail')!.login!.access)).toBe('gmail.readonly');
    expect(accessForDisplay(howToConnectFor('slack')!.login!.access)).toBe(SLACK_SOURCE_SCOPES.join(', '));
  });

  it('an unknown connector has no declaration', () => {
    expect(howToConnectFor('no-such-connector')).toBeNull();
    expect(platformForConnectorSlug('no-such-connector')).toBeNull();
  });
});
