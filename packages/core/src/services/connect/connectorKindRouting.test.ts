import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/links', () => ({ workspaceUrl: (slug: string, path: string) => `/w/${slug}${path}` }));
vi.mock('@/libs/sources/registry', () => ({ getConnector: () => null }));

const { decideKind } = await import('./connectorKindRouting');

const GMAIL = { slug: 'gmail', name: 'Gmail' };
const HUBSPOT = { slug: 'hubspot', name: 'HubSpot' };

describe('decideKind', () => {
  it('lets a team request through in a shared workspace', () => {
    expect(decideKind({ workspace: 'team', needs: undefined, connectors: [GMAIL, HUBSPOT], otherHref: null })).toEqual({ proceed: true });
    expect(decideKind({ workspace: 'team', needs: 'team', connectors: [GMAIL], otherHref: null })).toEqual({ proceed: true });
  });

  it('never asks for someone\'s own inbox as a team connector: one line pointing to Personal connectors instead', () => {
    const decision = decideKind({ workspace: 'team', needs: 'personal', connectors: [GMAIL], otherHref: '/w/personal-1a2b3c4d5e6f/dashboard/connectors' });

    expect(decision).toEqual({ proceed: false, reply: expect.stringContaining('Your own Gmail is a personal connector') });
    expect(decision.proceed || decision.reply).toContain('[Personal connectors](/w/personal-1a2b3c4d5e6f/dashboard/connectors)');
    expect(decision.proceed || decision.reply).toContain('show no card');
  });

  it('treats a "personal" request for a system nobody connects for themselves as the team one it is', () => {
    expect(decideKind({ workspace: 'team', needs: 'personal', connectors: [HUBSPOT], otherHref: null })).toEqual({ proceed: true });
  });

  it('never asks for a team system from Personal: it names Team connectors and links there', () => {
    const decision = decideKind({ workspace: 'personal', needs: undefined, connectors: [HUBSPOT], otherHref: '/w/northwind/dashboard/connectors' });

    expect(decision.proceed || decision.reply).toContain('HubSpot is a team connector');
    expect(decision.proceed || decision.reply).toContain('[Team connectors](/w/northwind/dashboard/connectors)');
  });

  it('sends a personal request in Personal to its own page, with no card', () => {
    const decision = decideKind({ workspace: 'personal', needs: undefined, connectors: [GMAIL], otherHref: null });

    expect(decision.proceed || decision.reply).toBe('Gmail is a personal connector — only your personal assistant reads it. Connect it in [Personal connectors](/dashboard/connectors). Say that in one line with the link; show no card.');
  });

  it('a "team" request for Gmail from Personal is a team connector, not the person\'s own', () => {
    const decision = decideKind({ workspace: 'personal', needs: 'team', connectors: [GMAIL], otherHref: null });

    expect(decision.proceed || decision.reply).toContain('Gmail is a team connector');
  });
});
