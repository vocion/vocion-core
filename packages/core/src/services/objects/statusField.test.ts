import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { markStatus, statusSnapshot } from './statusField';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');

/**
 * One writer per transition, on the record (Chris, 2026-10-02): a writer
 * names what happened, and the record's type says which status that is.
 */

const ORG = 'org_status_field';
const SCHEMA = parse(readFileSync(join(process.cwd(), 'templates/plugins/software-factory/objects/request/type.yaml'), 'utf8')).schema;

async function record(meta: Record<string, unknown>, schema: unknown = SCHEMA, slug = 'request'): Promise<number> {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: `${slug}-${Math.random().toString(36).slice(2, 8)}`, label: slug, schema: schema as Record<string, unknown> }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'A request', status: 'active', metadata: meta }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

async function metaOf(id: number): Promise<Record<string, unknown>> {
  const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row?.meta ?? {}) as Record<string, unknown>;
}

afterEach(async () => {
  await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
  await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
});

describe('markStatus', () => {
  it('writes the value the type gives the transition, with its line and time', async () => {
    const id = await record({ state: 'building', status: 'in_qa' });

    await expect(markStatus(ORG, id, 'merge_waits', { line: 'QA approved 8 of 8; the merge waits on a person (infra class).', at: '2026-10-02T05:31:31.000Z' })).resolves.toBe('awaiting_merge');
    expect(await metaOf(id)).toMatchObject({ state: 'building', status: 'awaiting_merge', statusLine: 'QA approved 8 of 8; the merge waits on a person (infra class).', statusAt: '2026-10-02T05:31:31.000Z' });
  });

  it('writes nothing for a transition the type does not declare, or a type with no status', async () => {
    const id = await record({ status: 'deploying' });
    const plain = await record({ state: 'x' }, { type: 'object', properties: { state: { type: 'string' } } }, 'note');

    await expect(markStatus(ORG, id, 'checking_live')).resolves.toBeNull();
    await expect(markStatus(ORG, plain, 'building')).resolves.toBeNull();
    expect(await metaOf(id)).toEqual({ status: 'deploying' });
    expect(await metaOf(plain)).toEqual({ state: 'x' });
  });

  it('never moves a finished request back into the work unless a person reopens it (FE-224)', async () => {
    const id = await record({ state: 'shipped', status: 'shipped', shippedAt: '2026-10-02T03:19:08Z' });

    await expect(markStatus(ORG, id, 'qa_changes', { line: 'QA sent it back: 0 of 3 criteria proven.' })).resolves.toBeNull();
    expect((await metaOf(id)).status).toBe('shipped');
    await expect(markStatus(ORG, id, 'building', { line: 'RUN-9 is building task #1.', reopen: true })).resolves.toBe('building');
  });

  it('leaves a finished request as it is when asked to keep it (a re-linked release)', async () => {
    const id = await record({ status: 'seen_live' });

    await expect(markStatus(ORG, id, 'shipped', { keepFinished: true })).resolves.toBeNull();
    expect((await metaOf(id)).status).toBe('seen_live');
  });

  it('writes nothing when it already reads so, in the same words', async () => {
    const id = await record({ status: 'awaiting_merge', statusLine: 'QA approved 8 of 8.', statusAt: '2026-10-01T00:00:00.000Z' });

    await expect(markStatus(ORG, id, 'merge_waits', { line: 'QA approved 8 of 8.' })).resolves.toBeNull();
    expect((await metaOf(id)).statusAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('snapshots the status for an Undo to write back', async () => {
    const id = await record({ status: 'deciding', statusLine: 'Filed; the Build card is waiting on a person (ACT-1).' });

    await expect(statusSnapshot(ORG, id)).resolves.toEqual({ status: 'deciding', statusLine: 'Filed; the Build card is waiting on a person (ACT-1).', statusAt: null });
  });
});
