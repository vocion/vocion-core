/**
 * The link a setup step carries: the vendor login when the deployment has
 * it configured and the workspace has a source to scope it to; the Connectors
 * page otherwise, with the reason said.
 */
import { describe, expect, it, vi } from 'vitest';

const option = vi.hoisted(() => ({ value: null as null | { provider: string; label: string; configured: boolean; requiredEnv: string[] } }));
vi.mock('@/libs/connect/registry', () => ({ connectOptionFor: () => option.value }));
vi.mock('@/services/plugins/setupState', () => ({ setupStateForOrg: async () => [] }));

const { connectorStepHref } = await import('./describeSetup');

describe('connectorStepHref', () => {
  it('points at the vendor login, scoped to the first declared source, when the login is configured', () => {
    option.value = { provider: 'github', label: 'GitHub', configured: true, requiredEnv: [] };

    expect(connectorStepHref({ slug: 'github', sources: ['github'] })).toEqual({
      href: '/api/connect/github/start?source=github',
      how: 'log in with GitHub (a workspace admin; the login is the approval)',
    });
  });

  it('falls back to the Connectors page and says the login is not configured', () => {
    option.value = { provider: 'atlassian', label: 'Atlassian', configured: false, requiredEnv: ['ATLASSIAN_CLIENT_ID'] };

    const out = connectorStepHref({ slug: 'jira', sources: ['jira'] });

    expect(out.href).toBe('/dashboard/connectors');
    expect(out.how).toContain('not configured');
  });

  it('says when the workspace has no source of the kind yet, even with a login configured', () => {
    option.value = { provider: 'github', label: 'GitHub', configured: true, requiredEnv: [] };

    const out = connectorStepHref({ slug: 'github', sources: [] });

    expect(out.href).toBe('/dashboard/connectors');
    expect(out.how).toContain('declares no source');
  });

  it('is the Connectors page for a connector with no vendor login', () => {
    option.value = null;

    expect(connectorStepHref({ slug: 'granola', sources: ['granola'] })).toEqual({
      href: '/dashboard/connectors',
      how: 'paste a credential on the Connectors page',
    });
  });
});
