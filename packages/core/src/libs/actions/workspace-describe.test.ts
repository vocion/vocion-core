import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { workspaceDescribeAction } = await import('./workspace-describe');

const ORG = 'org_describe';
async function descriptionOf(): Promise<string | null> {
  const [row] = await db.select({ d: projectSchema.description }).from(projectSchema).where(eq(projectSchema.id, ORG));
  return row!.d;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-describe', name: 'Acme', slug: 'acme-describe' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-describe', slug: 'acme', name: 'Acme', description: 'Old words' });
});

describe('workspace.describe', () => {
  it('refuses a description too short to say what the workspace is for', () => {
    expect(workspaceDescribeAction.inputSchema.safeParse({ description: 'eng' }).success).toBe(false);
  });

  it('saves the description, and undo puts the previous one back', async () => {
    const input = workspaceDescribeAction.inputSchema.parse({ description: '  Acme support: answer tickets within a day.  ' });
    const result = await workspaceDescribeAction.execute({ orgId: ORG }, input);

    expect(await descriptionOf()).toBe('Acme support: answer tickets within a day.');

    await workspaceDescribeAction.undo!({ orgId: ORG }, input, result);

    expect(await descriptionOf()).toBe('Old words');
  });
});
