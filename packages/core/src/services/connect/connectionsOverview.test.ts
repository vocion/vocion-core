import type { ConnectCandidate } from '@/libs/connect/systemsPlan';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/sources/registry', () => ({
  listConnectors: () => [{ slug: 'quickbooks' }, { slug: 'github' }, { slug: 'web' }],
}));
vi.mock('@/libs/platforms/registry', () => ({
  howToConnectFor: (slug: string) => ({
    // A login and nothing to paste.
    quickbooks: { login: { provider: 'quickbooks' } },
    // A login, or a token to paste.
    github: { login: { provider: 'github' }, paste: { credential: 'Personal access token', access: [] } },
  } as Record<string, unknown>)[slug] ?? null,
}));

const { pickRecommendations, unavailableConnectors, usedByConnector } = await import('./connectionsOverview');

const candidate = (connector: string, evidence: ConnectCandidate['evidence']): ConnectCandidate => ({
  connector,
  name: connector.toUpperCase(),
  score: 0,
  recommended: false,
  evidence,
  method: { kind: 'page', href: '' },
  unlocks: [],
});

describe('pickRecommendations', () => {
  it('keeps at most three with evidence behind them, each with the reason chat gives', () => {
    const picked = pickRecommendations([
      candidate('github', [{ kind: 'app', app: 'software-factory', appName: 'Software Factory', needed: true }]),
      candidate('gmail', [{ kind: 'mail', domain: 'northwind.example' }]),
      candidate('notion', []),
      candidate('hubspot', [{ kind: 'org', workspaces: 2 }]),
      candidate('jira', [{ kind: 'org', workspaces: 1 }]),
    ]);

    expect(picked).toEqual([
      { slug: 'github', name: 'GITHUB', why: 'Software Factory needs it' },
      { slug: 'gmail', name: 'GMAIL', why: 'Mail at northwind.example is hosted there' },
      { slug: 'hubspot', name: 'HUBSPOT', why: 'Used in 2 other workspaces of your Org' },
    ]);
  });
});

describe('unavailableConnectors', () => {
  it('is a connector whose only way in is a login this server has no app for', () => {
    expect(unavailableConnectors({})).toEqual(['quickbooks']);
    expect(unavailableConnectors({ quickbooks: { providerLabel: 'QuickBooks' } })).toEqual([]);
  });
});

describe('usedByConnector', () => {
  it('names the agents that search a connector\'s sources and the added apps that read it, once each', () => {
    const used = usedByConnector({
      sources: [{ slug: 'northwind-docs', connector: 'web' }, { slug: 'northwind-blog', connector: 'web' }, { slug: 'github', connector: 'github' }],
      agents: [
        { name: 'Support lead', connectorSources: ['northwind-docs', 'northwind-blog'] },
        { name: 'Revenue lead', connectorSources: ['hubspot'] },
      ],
      apps: [{ name: 'Software Factory', connectors: ['github', 'sentry'] }],
    });

    expect(used).toEqual({ web: ['Support lead'], github: ['Software Factory'] });
  });
});
