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
  it('asks what the workspace is for when there is no description', () => {
    expect(svc.onboardingOpeningMessage({ workspaceName: 'Northwind Fresh', description: null })).toMatch(/what is this workspace for/i);
  });

  it('confirms an existing description instead of asking again', () => {
    const text = svc.onboardingOpeningMessage({ workspaceName: 'Northwind Eng', description: 'Northwind engineering' });

    expect(text).toContain('"Northwind engineering"');
    expect(text).not.toMatch(/what is this workspace for/i);
  });
});
