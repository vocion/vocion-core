/**
 * The link a setup step carries: the Connectors page's add flow for the
 * connector, back to the conversation — the one connect path (#1080), the
 * same one `offer_connection`'s card opens — and a note when the workspace
 * has no source of the kind yet.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/plugins/setupState', () => ({ setupStateForOrg: async () => [] }));

const { connectorStepHref } = await import('./describeSetup');

describe('connectorStepHref', () => {
  it('points at the Connectors add flow for the connector, returning to the conversation', () => {
    expect(connectorStepHref({ slug: 'github', sources: ['github'] }, 42)).toEqual({
      href: '/dashboard/connectors?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D42',
      how: 'connect it on the Connectors page (a workspace admin; the login or the pasted key is the approval), or offer it as a card with offer_connection',
    });
  });

  it('returns to chat itself when the turn has no conversation', () => {
    expect(connectorStepHref({ slug: 'jira', sources: ['jira'] }, null).href).toBe('/dashboard/connectors?add=jira&returnTo=%2Fdashboard%2Fchat');
  });

  it('says when the workspace has no source of the kind yet', () => {
    const out = connectorStepHref({ slug: 'github', sources: [] }, 7);

    expect(out.href).toContain('add=github');
    expect(out.how).toContain('declares no source');
  });
});
