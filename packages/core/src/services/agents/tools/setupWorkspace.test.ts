import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import process from 'node:process';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The workspace lead's setup tools. A plan goes in as typed steps and comes
 * out as typed cards — one per step that can run, each naming the action that
 * runs it — and the steps that could only fail are left out with their reason
 * in the result for the lead to read. Nothing runs here: a card is an offer.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/routers/AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
// The company's own site, as Firecrawl's branding extractor reads it.
const lookupBrand = vi.fn();
vi.mock('@/libs/tools/brand/firecrawlBrand', () => ({ lookupBrand }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { proposeBrand, proposeSetup, setupOptions, setupWorkspaceTools } = await import('./setupWorkspace');
const { BRAND_CARD_KIND, readCard, SETUP_CARD_KIND } = await import('@/libs/cards/card');
const { decodeDraft } = await import('@/libs/branding/draft');
const { ProviderNotConfiguredError } = await import('@/libs/tools/types');
const { safeListApps } = await import('@/libs/workspace/apps');
const { listCatalog } = await import('@/services/CatalogService');

const ORG = 'proj-setup-support';
const app = safeListApps().find(a => !a.core && !a.hidden && a.plugins.length > 0)!;
const role = listCatalog()[0]!;

function ctxFor(emit: (event: { type: string; card?: Card }) => void, opts: { userId?: string; kind?: 'shared' | 'personal'; grants?: string[] } = {}): RuntimeContext {
  return {
    orgId: ORG,
    userId: opts.userId ?? 'usr-setup-dana',
    agentSlug: 'workspace-lead',
    conversationId: 12,
    workspaceKind: opts.kind ?? 'shared',
    harnessConfig: { grantTools: opts.grants ?? ['setup_options', 'propose_setup'] },
    connectorSources: [],
    emit,
  } as unknown as RuntimeContext;
}

function cardsFrom(emit: ReturnType<typeof vi.fn>): Card[] {
  return emit.mock.calls.map(([e]) => (e as { card: Card }).card).filter(Boolean);
}

beforeAll(async () => {
  delete process.env.WORKSPACE_PATH;
  await db.insert(tenantAccountSchema).values({ id: 'acct-setup', name: 'Northwind', slug: 'northwind-setup' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-setup', slug: 'support', name: 'Northwind Support' });
  await db.insert(userSchema).values([
    { id: 'usr-setup-dana', email: 'dana@northwind.example' },
    { id: 'usr-setup-omar', email: 'omar@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-setup', userId: 'usr-setup-dana', role: 'admin' },
    { accountId: 'acct-setup', userId: 'usr-setup-omar', role: 'member' },
  ]);
  await db.insert(agentSchema).values({ orgId: ORG, projectId: ORG, slug: 'workspace-lead', name: 'Workspace lead', systemPrompt: 'x', role: 'lead' });
});

describe('propose_setup', () => {
  it('turns each step into a typed setup card naming the action that runs it', async () => {
    const emit = vi.fn();
    const said = await proposeSetup(ctxFor(emit), {
      steps: [
        { kind: 'app', id: app.id, why: 'Requests become fixes the asker hears about.' },
        { kind: 'hire', id: role.slug, why: 'Owns the Friday report on open tickets.' },
        { kind: 'invite', emails: ['ana@northwind.example'], why: 'So Ana sees the Friday report.' },
      ],
    });
    const cards = cardsFrom(emit);

    expect(cards.map(c => [c.kind, c.actions[0]?.actionId])).toEqual([
      [SETUP_CARD_KIND, 'app.install'],
      [SETUP_CARD_KIND, 'team.hire_agent'],
      [SETUP_CARD_KIND, 'members.invite'],
    ]);
    expect(cards.every(c => readCard(c).ok && c.state === 'proposed' && c.source.tool === 'propose_setup')).toBe(true);
    expect(cards[0]).toMatchObject({ title: `Add ${app.name}`, body: 'Requests become fixes the asker hears about.', actions: [{ label: 'Add', input: { app: app.id } }], href: app.entry });
    expect(cards[1]?.actions[0]?.input).toMatchObject({ slug: role.slug, reason: 'Owns the Friday report on open tickets.' });
    expect(cards[2]?.actions[0]?.input).toEqual({ emails: ['ana@northwind.example'], role: 'member' });
    expect(said).toContain('Showed 3 cards');
    expect(said).toContain('Nothing has run');
  });

  it('leaves out what could only fail and says why, for the lead to read', async () => {
    const emit = vi.fn();
    const said = await proposeSetup(ctxFor(emit), {
      steps: [
        { kind: 'app', id: 'no-such-app', why: 'x' },
        { kind: 'hire', id: 'workspace-lead', why: 'x' },
        { kind: 'invite', emails: ['dana@northwind.example'], why: 'x' },
        { kind: 'invite', why: 'x' },
        // No folder of its own on this host: a template has nowhere to be written.
        { kind: 'template', id: 'company/support-org', why: 'x' },
      ],
    });

    expect(cardsFrom(emit)).toEqual([]);
    expect(said).toContain('Showed no cards');
    expect(said).toContain('no app "no-such-app"');
    expect(said).toContain('no catalog role "workspace-lead"');
    expect(said).toContain('already in this workspace');
    expect(said).toContain('ask who should join');
    expect(said).toContain('applied from git');
  });

  it('offers no invite to someone who cannot invite', async () => {
    const emit = vi.fn();
    const said = await proposeSetup(ctxFor(emit, { userId: 'usr-setup-omar' }), { steps: [{ kind: 'invite', emails: ['ana@northwind.example'], why: 'x' }] });

    expect(cardsFrom(emit)).toEqual([]);
    expect(said).toContain('only an admin can invite people');
  });

  it('the same step twice is one card', async () => {
    const emit = vi.fn();
    await proposeSetup(ctxFor(emit), { steps: [{ kind: 'app', id: app.id, why: 'a' }, { kind: 'app', id: app.id, why: 'b' }] });

    expect(cardsFrom(emit)).toHaveLength(1);
  });
});

describe('setup_options', () => {
  it('says where the workspace stands and what it could add', async () => {
    const text = await setupOptions(ctxFor(vi.fn()));

    // Two people are in the Org already, so inviting someone is done.
    expect(text).toContain('1 of 5 first steps');
    expect(text).toContain('Make it yours (logo and colours): not yet');
    expect(text).toContain('Invite someone: done');
    expect(text).toContain(`- ${app.id} — ${app.name}`);
    expect(text).toContain(`- ${role.slug} — ${role.name}`);
    expect(text).toContain('INVITE (step {kind:"invite"');
    // Templates with the keys their interview takes, and why one cannot be written here.
    expect(text).toContain('- company/support-org — Support Org');
    expect(text).toContain('product ("What do customers come to you for help with?")');
    expect(text).toContain('A template cannot be written into this workspace here');
  });

  it('tells the lead a member cannot invite or connect', async () => {
    const text = await setupOptions(ctxFor(vi.fn(), { userId: 'usr-setup-omar' }));

    expect(text).toContain('this person is not an admin');
  });
});

describe('who holds the tools', () => {
  it('only an agent granted them, and only in a shared workspace', () => {
    // The brand preview is a step of the same plan: holding the plan holds it.
    expect(setupWorkspaceTools(ctxFor(vi.fn())).map(t => t.name)).toEqual(['setup_options', 'propose_setup', 'propose_brand']);
    expect(setupWorkspaceTools(ctxFor(vi.fn(), { grants: ['propose_brand'] })).map(t => t.name)).toEqual(['propose_brand']);
    expect(setupWorkspaceTools(ctxFor(vi.fn(), { grants: [] }))).toEqual([]);
    expect(setupWorkspaceTools(ctxFor(vi.fn(), { kind: 'personal' }))).toEqual([]);
  });
});

describe('propose_brand — "brand this workspace from <site>"', () => {
  const NORTHWIND_SITE = {
    url: 'https://northwind.example',
    name: 'Northwind | Home',
    logoUrl: 'https://northwind.example/logo.svg',
    faviconUrl: 'https://northwind.example/favicon.ico',
    colors: { primary: '#1f6feb', background: '#ffffff', textPrimary: '#111111' },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    confidence: 0.82,
  };

  beforeEach(() => {
    lookupBrand.mockReset();
  });

  it('reads the site, drafts the brand and shows ONE preview card with its three choices', async () => {
    lookupBrand.mockResolvedValueOnce(NORTHWIND_SITE);
    const emit = vi.fn();
    const said = await proposeBrand(ctxFor(emit), { site: 'northwind.example' });
    const [card] = cardsFrom(emit);

    expect(lookupBrand).toHaveBeenCalledWith('northwind.example', { orgId: ORG });
    expect(card?.kind).toBe(BRAND_CARD_KIND);
    expect(readCard(card).ok).toBe(true);
    expect(card?.title).toBe('Make it yours: Northwind');
    // Use this brand: the person's action, applying exactly the draft.
    expect(card?.actions).toEqual([expect.objectContaining({ label: 'Use this brand', actionId: 'org.brand_apply' })]);
    expect(card?.actions[0]?.input).toMatchObject({ name: 'Northwind', accent: '#1f6feb', headingFont: 'Space Grotesk', senderName: 'Northwind', logos: { wordmark: 'https://northwind.example/logo.svg' }, website: 'https://northwind.example' });
    // Adjust: Brand settings, with the same draft in the link.
    expect(card?.href).toMatch(/^\/dashboard\/brand\?draft=/);
    expect(decodeDraft(new URL(`https://x.example${card!.href}`).searchParams.get('draft'))).toMatchObject({ name: 'Northwind', accent: '#1f6feb' });
    // What the site did not give is said on the card, not guessed.
    expect(card?.fields?.map(f => f.value).join(' ')).toContain('.ico');
    expect(said).toContain('Nothing has changed yet');
  });

  it('a member is not shown a card: only an Org admin brands the Org', async () => {
    lookupBrand.mockResolvedValue(NORTHWIND_SITE);
    const emit = vi.fn();
    const said = await proposeBrand(ctxFor(emit, { userId: 'usr-setup-omar' }), { site: 'northwind.example' });

    expect(cardsFrom(emit)).toEqual([]);
    expect(said).toContain('only an Org admin');
  });

  it('with no lookup configured, the one move left is a link to Brand settings', async () => {
    lookupBrand.mockRejectedValueOnce(new ProviderNotConfiguredError('brand lookup', 'firecrawl', ['FIRECRAWL_API_KEY']));
    const emit = vi.fn();
    const said = await proposeBrand(ctxFor(emit), { site: 'northwind.example' });
    const [card] = cardsFrom(emit);

    expect(card).toMatchObject({ kind: 'link', href: '/dashboard/brand' });
    expect(said).toContain('not set up');
  });

  it('a site whose only colour cannot be worn keeps Vocion\'s accent, and says so', async () => {
    lookupBrand.mockResolvedValueOnce({ ...NORTHWIND_SITE, colors: { primary: '#ffff00' } });
    const emit = vi.fn();
    await proposeBrand(ctxFor(emit), { site: 'northwind.example' });
    const [card] = cardsFrom(emit);

    expect(card?.actions[0]?.input).toMatchObject({ accent: null });
    expect(card?.fields?.map(f => f.value).join(' ')).toContain('accent stays Vocion');
  });

  it('as a step of a plan, it needs the site', async () => {
    const emit = vi.fn();
    const said = await proposeSetup(ctxFor(emit), { steps: [{ kind: 'brand', why: 'So it looks like ours.' }] });

    expect(cardsFrom(emit)).toEqual([]);
    expect(said).toContain('ask for their website');
  });
});
