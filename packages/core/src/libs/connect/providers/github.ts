/**
 * PLACEHOLDER. The GitHub provider is written in its own pull request against
 * the same `ConnectProvider` shape; until that lands this module only says
 * "not configured" so the registry, the routes and the UI compile and the
 * paste form keeps working for the connector.
 */

import type { ConnectProvider } from '../provider';

export const githubProvider: ConnectProvider = {
  id: 'github',
  connectorSlugs: ['github'],
  label: 'GitHub',
  requiredEnv: [],
  configured: () => false,
  authorizeUrl: () => {
    throw new Error('GitHub connect is not implemented yet');
  },
  exchange: async () => ({ ok: false, reason: 'not_implemented' }),
};
