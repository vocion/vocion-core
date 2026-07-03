/**
 * Per-connection ACL resolution against PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, userSchema } = await import('@/models/Schema');
const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');

const ORG = 'org_acl';

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values([
    { id: 'usr-chris', email: 'chris@metacto.com', name: 'Chris' },
    { id: 'usr-jamie', email: 'jamie@metacto.com', name: 'Jamie' },
  ]);
  await db.insert(knowledgeSourceSchema).values([
    { orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: {} },
    { orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: {}, accessPolicy: { visibility: 'restricted', users: ['chris@metacto.com'] } },
    { orgId: ORG, slug: 'drive', kind: 'plugin', configJson: {}, accessPolicy: { visibility: 'org' } },
  ]);
});

afterAll(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(userSchema);
});

describe('allowedSourceSlugsForUser', () => {
  it('grants restricted sources only to listed members', async () => {
    expect((await allowedSourceSlugsForUser(ORG, 'usr-chris')).sort()).toEqual(['drive', 'gmail', 'hubspot']);
    expect((await allowedSourceSlugsForUser(ORG, 'usr-jamie')).sort()).toEqual(['drive', 'hubspot']);
  });

  it('treats unknown users as ungranted', async () => {
    expect((await allowedSourceSlugsForUser(ORG, 'usr-nobody')).sort()).toEqual(['drive', 'hubspot']);
  });

  it('matches grant emails case-insensitively', async () => {
    await db.insert(userSchema).values({ id: 'usr-caps', email: 'CHRIS@METACTO.COM'.toLowerCase(), name: 'C' }).onConflictDoNothing();
    const slugs = await allowedSourceSlugsForUser(ORG, 'usr-chris');

    expect(slugs).toContain('gmail');
  });
});
