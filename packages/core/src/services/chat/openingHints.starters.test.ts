/**
 * STARTERS CHANGE WITH WHAT IS CONNECTED (founder, 2026-10-09: "better default
 * recommendation chips … dynamic based on what's enabled in a workspace").
 * Against PGlite for the workspace and its Org; the person's own connections
 * are the one input faked, as the state under test.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

let connected: string[] = [];
vi.mock('@/services/personal/connections', () => ({
  ownPersonalWorkspace: vi.fn(async (orgId: string, userId: string) => (orgId === 'proj-starters-home' && userId === 'usr-starters-dana' ? { projectId: 'proj-starters-home', accountId: 'acct-starters' } : null)),
  personalConnectionsAllowed: vi.fn(async () => true),
  listPersonalConnections: vi.fn(async () => ['gmail', 'google-calendar', 'drive'].map(c => ({ connector: c, connectedAt: connected.includes(c) ? new Date() : null }))),
}));

const ACCOUNT = 'acct-starters';
const HOME = 'proj-starters-home';
const FACTORY = 'proj-starters-factory';
const DANA = 'usr-starters-dana';

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { loadOpeningHints, starterInputs } = await import('./openingHints');

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-starters' });
  await db.insert(userSchema).values({ id: DANA, email: 'dana@northwind.example' });
  await db.insert(projectSchema).values([
    { id: HOME, accountId: ACCOUNT, slug: 'personal-starters', name: 'Personal', kind: 'personal', ownerUserId: DANA },
    { id: FACTORY, accountId: ACCOUNT, slug: 'factory-starters', name: 'Northwind Factory', enabledPlugins: ['wiki', 'software-factory'] },
  ]);
});

beforeEach(() => {
  connected = [];
});

describe('a Personal workspace\'s starters', () => {
  it('with nothing connected: connect first, then what needs no connection', async () => {
    const labels = (await starterInputs({ orgId: HOME, userId: DANA, credentials: null })).map(s => s.label);

    expect(labels).toEqual(['Connect my Gmail and calendar', 'What\'s waiting on me across Northwind?', 'Set up my morning brief']);
  });

  it('with Gmail and calendar connected: the mail and the day', async () => {
    connected = ['gmail', 'google-calendar'];
    const labels = (await starterInputs({ orgId: HOME, userId: DANA, credentials: null })).map(s => s.label);

    expect(labels).toEqual(['What emails do I owe replies to?', 'Prep me for today\'s meetings', 'What\'s waiting on me across Northwind?']);
  });

  it('reach the composer as up to three pills, in place of the generic tour', async () => {
    const hints = await loadOpeningHints({ orgId: HOME, userId: DANA, isAdmin: true, leadSpoken: 'your assistant' });

    expect(hints.map(h => h.type)).toEqual(['starter', 'starter', 'starter']);
    expect(hints[0]).toMatchObject({ label: 'Connect my Gmail and calendar →', action: { kind: 'send', prompt: 'Help me connect my Gmail and calendar' } });
    expect(hints.some(h => h.type === 'capability')).toBe(false);
  });
});

describe('a shared workspace\'s starters come from its apps', () => {
  it('offers an app\'s starter only once what it needs is connected', async () => {
    const without = (await starterInputs({ orgId: FACTORY, userId: DANA, credentials: { byConnectorSlug: {} } })).map(s => s.label);

    expect(without).toContain('What does our wiki say about how we work?');
    expect(without).not.toContain('What is the factory building right now?');

    const withGithub = (await starterInputs({ orgId: FACTORY, userId: DANA, credentials: { byConnectorSlug: { github: { connected: true, broken: null } } } })).map(s => s.label);

    expect(withGithub).toContain('What is the factory building right now?');
  });
});
