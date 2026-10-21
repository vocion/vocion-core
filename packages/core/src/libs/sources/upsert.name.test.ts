/**
 * A source's display name is written without counting as a config change: a
 * manifest that starts carrying names must not queue a full sync of every
 * source it declares.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { upsertSourceRow } = await import('./upsert');
const { sourceNameOf } = await import('./upsert');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');

const known = { learningSteps: new Set<string>(), agentSlugs: new Set<string>() };
const spec = { slug: 'northwind-site', kind: 'web', config: { urls: ['https://northwind.example'] }, enabled: true };

describe('a source renamed', () => {
  it('stores the new name and reads as unchanged; a real config change still reads as updated', async () => {
    await expect(upsertSourceRow('org_name_only', spec, { known })).resolves.toMatchObject({ outcome: 'created' });
    await expect(upsertSourceRow('org_name_only', { ...spec, name: 'Northwind site' }, { known })).resolves.toMatchObject({ outcome: 'unchanged' });

    const [row] = await db.select({ config: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, 'org_name_only'));

    expect(sourceNameOf(row?.config, 'northwind-site')).toBe('Northwind site');
    await expect(upsertSourceRow('org_name_only', { ...spec, name: 'Northwind site', config: { urls: ['https://northwind.example/blog'] } }, { known })).resolves.toMatchObject({ outcome: 'updated' });
  });
});
