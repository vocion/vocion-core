import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/services/adoption/WorkforceService', () => ({ getWorkforceInventory: vi.fn(async (orgId: string) => ({ workspaceId: orgId })) }));
vi.mock('@/services/workforce/ledger', () => ({ readWorkforceOutcomes: vi.fn(async (orgId: string) => ({ workspaceId: orgId, complete: true, test: false, items: [] })) }));
const { db } = await import('@/libs/DB');
const { tenantAccountSchema, projectSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { getWorkforceInventory } = await import('@/services/adoption/WorkforceService');
const { readWorkforceOutcomes } = await import('@/services/workforce/ledger');
const { saveWorkforcePortfolio } = await import('@/services/workforce/portfolio');
const { GET } = await import('./route');
const orgId = 'transform-export-a';
const other = 'transform-export-b';
const id = randomUUID();
const data = { name: 'Exported capability', objective: '', owner: '', baseline: '', expectedBenefit: '', successMeasure: '', teamSlug: null, stage: 'pilot' as const, improvements: [] };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'transform-account', name: 'Test account', slug: 'transform-test' });
  await db.insert(projectSchema).values([orgId, other].map(id => ({ id, accountId: 'transform-account', slug: id, name: id })));
  await saveWorkforcePortfolio(orgId, 'admin', { id, eventKey: randomUUID(), version: -1, data, itemIds: [] });
  await saveWorkforcePortfolio(orgId, 'admin', { id, eventKey: randomUUID(), version: 0, data: { ...data, owner: 'Test owner' }, itemIds: [] });
  await saveWorkforcePortfolio(other, 'admin', { id: randomUUID(), eventKey: randomUUID(), version: -1, data: { ...data, name: 'Foreign private capability' }, itemIds: [] });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'admin', orgId, role: 'admin', workspaceRole: 'admin' } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(null);
});

it('exports only the authenticated workspace and preserves complete revision history', async () => {
  const response = await GET(new Request(`https://vocion.test/api/v1/transform/export?days=7&workspaceId=${other}`));

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');

  const body = await response.json();

  expect(body.workspace.id).toBe(orgId);
  expect(body.portfolio.workflows).toHaveLength(1);
  expect(body.history.map((h: { version: number }) => h.version)).toEqual([0, 1]);
  expect(JSON.stringify(body)).not.toContain('Foreign private capability');
  expect(getWorkforceInventory).toHaveBeenCalledWith(orgId, 7);
  expect(readWorkforceOutcomes).toHaveBeenCalledWith(orgId, expect.any(Date), expect.any(Date), false);
});

it('refuses members, missing sessions and invalid bearer credentials', async () => {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'member', orgId, role: 'member', workspaceRole: 'member' } as never);

  expect((await GET(new Request('https://vocion.test/api/v1/transform/export'))).status).toBe(403);

  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null } as never);

  expect((await GET(new Request('https://vocion.test/api/v1/transform/export'))).status).toBe(401);
  expect((await GET(new Request('https://vocion.test/api/v1/transform/export', { headers: { Authorization: 'Bearer invalid' } }))).status).toBe(401);
  expect(getWorkforceInventory).not.toHaveBeenCalled();
});

it('rejects incomplete evidence and invalid periods rather than exporting plausible partial totals', async () => {
  expect((await GET(new Request('https://vocion.test/api/v1/transform/export?days=365'))).status).toBe(400);

  vi.mocked(readWorkforceOutcomes).mockResolvedValueOnce({ complete: false } as never);

  expect((await GET(new Request('https://vocion.test/api/v1/transform/export'))).status).toBe(422);
});
