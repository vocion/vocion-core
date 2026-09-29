import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema } = await import('@/models/Schema');
const { artifactImageUrl } = await import('./fetchImage');

beforeEach(async () => {
  await db.delete(artifactSchema);
});

describe('artifactImageUrl', () => {
  it('reads an artifact page in this workspace as the image it stores, and nothing across workspaces', async () => {
    const [ours] = await db.insert(artifactSchema).values({ orgId: 'org_a', kind: 'file', title: 'after', url: 'https://files.example/qa/after.png', spec: {} } as never).returning({ id: artifactSchema.id });
    const [theirs] = await db.insert(artifactSchema).values({ orgId: 'org_b', kind: 'file', title: 'x', url: 'https://files.example/qa/x.png', spec: {} } as never).returning({ id: artifactSchema.id });

    expect(await artifactImageUrl('org_a', `https://agents.example/dashboard/artifacts/${ours!.id}`)).toBe('https://files.example/qa/after.png');
    expect(await artifactImageUrl('org_a', `https://agents.example/w/northwind/dashboard/artifacts/${ours!.id}?x=1`)).toBe('https://files.example/qa/after.png');
    expect(await artifactImageUrl('org_a', `https://agents.example/dashboard/artifacts/${theirs!.id}`)).toBeNull();
    expect(await artifactImageUrl('org_a', 'https://files.example/qa/after.png')).toBeNull();
  });

  it('hands over Vocion\'s stored copy once the image was kept, so the reviewer reads the copy and not an expired link', async () => {
    const stored = '/api/artifacts/org_a-0123456789abcdef/org_a-0123456789abcdef.png';
    const [kept] = await db.insert(artifactSchema).values({ orgId: 'org_a', kind: 'link', title: 'after', url: stored, sourceUrl: 'https://files.example/qa/after.png?X-Amz-Expires=604800', spec: { href: stored, title: 'after' } } as never).returning({ id: artifactSchema.id });

    expect(await artifactImageUrl('org_a', `https://agents.example/dashboard/artifacts/${kept!.id}`)).toBe(stored);
  });
});
