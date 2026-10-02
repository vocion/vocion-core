import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const svc = await import('./OnboardingService');

const FRESH = 'org_onb_fresh';
const DESCRIBED = 'org_onb_described';
const LEADLESS = 'org_onb_leadless';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-onb', name: 'Northwind', slug: 'northwind-onb' });
  await db.insert(projectSchema).values([
    { id: FRESH, accountId: 'acct-onb', slug: 'fresh', name: 'Northwind Fresh', leadAgentSlug: 'workspace-lead' },
    { id: DESCRIBED, accountId: 'acct-onb', slug: 'described', name: 'Northwind Eng', leadAgentSlug: 'workspace-lead', description: 'Northwind engineering: ship the customer portal.' },
    { id: LEADLESS, accountId: 'acct-onb', slug: 'leadless', name: 'Northwind Ops' },
  ]);
  await db.insert(knowledgeSourceSchema).values({ orgId: DESCRIBED, slug: 'github-northwind', configJson: { _connector: 'github', repos: ['northwind/portal'] } });
});

describe('onboardingStatus — computed from rows, never stored checkmarks', () => {
  it('a fresh workspace has nothing done and its next step is to describe it', async () => {
    const status = (await svc.onboardingStatus(FRESH))!;

    expect(status).toMatchObject({ startedAt: null, description: null, connectedConnectors: [], done: false });
    expect(svc.nextOnboardingStep(status)).toBe('describe');
  });

  it('a described workspace with a UI-added GitHub source is done and grows next', async () => {
    const status = (await svc.onboardingStatus(DESCRIBED))!;

    expect(status.connectedConnectors).toEqual(['github']);
    expect(status.done).toBe(true);
    expect(svc.nextOnboardingStep(status)).toBe('grow');
  });

  it('deleting the source makes the connect step not done again', async () => {
    await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, DESCRIBED));
    const status = (await svc.onboardingStatus(DESCRIBED))!;

    expect(status.done).toBe(false);
    expect(svc.nextOnboardingStep(status)).toBe('connect');
  });

  it('a whitespace-only description counts as no description', async () => {
    await db.update(projectSchema).set({ description: '   ' }).where(eq(projectSchema.id, FRESH));

    expect((await svc.onboardingStatus(FRESH))!.description).toBeNull();
  });
});

describe('claimOnboardingStart — once per workspace', () => {
  it('the first claim wins and the second loses', async () => {
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-1')).toBe(true);
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-2')).toBe(false);
  });

  it('release by the claimer reopens it; release by someone else does not', async () => {
    await svc.releaseOnboardingStart(FRESH, 'usr-admin-2');

    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-3')).toBe(false);

    await svc.releaseOnboardingStart(FRESH, 'usr-admin-1');

    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-3')).toBe(true);
  });
});

describe('isOnboardingDue', () => {
  it('is never due for a member, so the first admin still gets it later', async () => {
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'member', resuming: false })).toBe(false);
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'admin', resuming: false })).toBe(true);
  });

  it('is not due when the person is resuming a conversation or arrived with a prompt', async () => {
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'admin', resuming: true })).toBe(false);
  });

  it('is not due for a workspace with no lead', async () => {
    expect(await svc.isOnboardingDue({ orgId: LEADLESS, role: 'admin', resuming: false })).toBe(false);
  });

  it('is not due once it has been opened', async () => {
    expect(await svc.isOnboardingDue({ orgId: FRESH, role: 'admin', resuming: false })).toBe(false);
  });
});

describe('onboardingOpeningMessage', () => {
  it('asks nothing in prose when there is no description: the opener card carries the question', () => {
    const text = svc.onboardingOpeningMessage({ workspaceName: 'Northwind Fresh', description: null });

    expect(text).toContain('Welcome to **Northwind Fresh**');
    expect(text).not.toContain('?');
  });

  it('confirms an existing description instead of asking again', () => {
    const text = svc.onboardingOpeningMessage({ workspaceName: 'Northwind Eng', description: 'Northwind engineering' });

    expect(text).toContain('"Northwind engineering"');
    expect(text).not.toMatch(/what is this workspace for/i);
    expect(text).not.toContain('?');
  });
});

describe('openerCard', () => {
  const catalog = [
    { slug: 'wiki', name: 'Wiki', when: ['a team keeps answering the same questions'] },
    { slug: 'data-rooms', name: 'Data rooms', when: [] },
    { slug: 'software-factory', name: 'Software factory', when: ['a deployment has repositories and wants changes proposed', 'second reason'] },
    { slug: 'proposals', name: 'Proposals', when: ['sales writes the same proposal again and again'] },
    { slug: 'growth-loop', name: 'Growth loop', when: ['signups need a nudge'] },
  ];

  it('puts an enabled plugin first, caps at three options, and describes each by its first reason', () => {
    const card = svc.openerCard({ plugins: catalog, enabled: ['proposals'] });

    expect(card).toMatchObject({ kind: 'choice', title: 'What do you want me taking off your plate?', allowOther: true, actions: [], body: 'Pick one, or type your own. I\'ll ask one thing at a time.' });
    expect(card.options!.map(o => o.label)).toEqual(['Proposals', 'Wiki', 'Software factory']);
    expect(card.options!.map(o => o.id)).toEqual(['A', 'B', 'C']);
    expect(card.options![2]!.description).toBe('a deployment has repositories and wants changes proposed');
    expect(card.options!.some(o => o.actions)).toBe(false);
  });

  it('skips a catalog plugin with no reason to recommend it, and cuts a long reason on a word boundary', () => {
    const long = `${'word '.repeat(60)}end`;
    const card = svc.openerCard({ plugins: [catalog[1]!, { slug: 'a', name: 'A', when: [long] }, catalog[0]!], enabled: [] });

    expect(card.options!.map(o => o.label)).toEqual(['A', 'Wiki']);
    expect(card.options![0]!.description!.length).toBeLessThanOrEqual(200);
    expect(card.options![0]!.description!.endsWith('word')).toBe(true);
  });

  it('is still a valid choice card with only two plugins to offer', () => {
    const card = svc.openerCard({ plugins: [catalog[0]!, catalog[3]!], enabled: [] });

    expect(card.options).toHaveLength(2);
  });
});
