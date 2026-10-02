import { describe, expect, it } from 'vitest';
import { JIRA_READ_SCOPES } from '@/libs/atlassian/oauth';
import { SLACK_SOURCE_SCOPES } from '@/libs/connect/providers/slack';
import { providerForConnector } from '@/libs/connect/registry';
import { howToConnectFor, listPlatforms, platformForConnectorSlug } from './registry';

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

  it('only documented https URLs are offered for making a credential by hand', () => {
    for (const platform of connectorPlatforms) {
      const url = platform.howToConnect?.paste.getItAt?.url;
      if (url) {
        expect(url.startsWith('https://'), platform.id).toBe(true);
      }
    }
  });

  it('login access matches the scopes the provider really asks for', () => {
    expect(howToConnectFor('jira')?.login?.access).toEqual([...JIRA_READ_SCOPES]);
    expect(howToConnectFor('slack')?.login?.access).toEqual([...SLACK_SOURCE_SCOPES]);
  });

  it('an unknown connector has no declaration', () => {
    expect(howToConnectFor('no-such-connector')).toBeNull();
    expect(platformForConnectorSlug('no-such-connector')).toBeNull();
  });
});
