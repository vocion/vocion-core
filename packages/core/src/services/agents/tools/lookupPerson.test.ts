/**
 * lookup_person: present for any of the three families; asks each directory
 * the agent reaches by email, turns a chat user id into an email first, and
 * says "not in this agent's sources" for a family it does not reach.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

const chat = vi.hoisted(() => ({ userInfo: vi.fn(), findUserByEmail: vi.fn() }));
const tracker = vi.hoisted(() => ({ findUserByEmail: vi.fn() }));
const host = vi.hoisted(() => ({ findUserByEmail: vi.fn() }));
vi.mock('@/services/chat/provider', () => ({ chatProviderFor: async () => chat }));
vi.mock('@/services/tracker/provider', () => ({ trackerProvidersFor: async () => [tracker] }));
vi.mock('@/services/repo/provider', () => ({ repoProviderFor: async () => host }));
vi.mock('@/libs/connectors/families', async () => {
  const real = await vi.importActual<typeof import('@/libs/connectors/families')>('@/libs/connectors/families');
  return { ...real, familySourcesForOrg: async () => [{ id: 1, slug: 'github', kind: 'github', config: { repos: ['Acme/app'] }, apiTokenId: null }] };
});

const { lookupPersonTools } = await import('./lookupPerson');

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[]): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'product-manager', connectorSources: sources, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

describe('lookup_person', () => {
  it('is present for an agent with any of the three families, absent otherwise', () => {
    expect(lookupPersonTools(ctxFor([]))).toHaveLength(0);
    expect(lookupPersonTools(ctxFor(['hubspot']))).toHaveLength(0);
    expect((lookupPersonTools(ctxFor(['jira'])) as unknown as Invokable[]).map(t => t.name)).toEqual(['lookup_person']);
  });

  it('asks every directory the agent reaches, by email', async () => {
    chat.findUserByEmail.mockResolvedValueOnce({ id: 'U1', name: 'Dana' });
    tracker.findUserByEmail.mockResolvedValueOnce({ accountId: '5d2', displayName: 'Dana Ortiz' });
    host.findUserByEmail.mockResolvedValueOnce(null);
    const [t] = lookupPersonTools(ctxFor(['slack', 'jira', 'github'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ email: 'Dana@Noco.com' }));

    expect(out).toMatchObject({ ok: true, email: 'dana@noco.com', chat: { id: 'U1', name: 'Dana' }, tracker: [{ accountId: '5d2' }], codeHost: null });
    expect(host.findUserByEmail).toHaveBeenCalledWith('org_1', 'Acme/app', 'dana@noco.com');
  });

  it('turns a chat user id into an email first, and names the families it does not reach', async () => {
    chat.userInfo.mockResolvedValueOnce({ id: 'U1', name: 'Dana', email: 'dana@noco.com' });
    tracker.findUserByEmail.mockResolvedValueOnce(null);
    const [t] = lookupPersonTools(ctxFor(['slack', 'jira'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ chat_user_id: 'U1' }));

    expect(out).toMatchObject({ ok: true, email: 'dana@noco.com', chat: { id: 'U1' }, tracker: null, codeHost: 'not in this agent\'s sources' });
  });

  it('says so when a chat user id yields no email', async () => {
    chat.userInfo.mockResolvedValueOnce({ id: 'U9', name: 'Bot', email: null });
    const [t] = lookupPersonTools(ctxFor(['slack'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ chat_user_id: 'U9' }));

    expect(out.ok).toBe(false);
    expect(out.error).toContain('did not give this user\'s email');
  });
});
