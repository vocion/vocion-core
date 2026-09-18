/**
 * Remove the data rooms the `documents` E2E creates, so the spec is
 * repeatable on a database that keeps state between runs (a local dev
 * server). A room by the same name left over from the last run would make
 * the filing step a neck-and-neck match — correctly not filed, and the test
 * would fail for the right reason on the wrong day.
 *
 *   npx dotenv -c -- npx tsx e2e/documents/support/reset-rooms.ts [title]
 */

import process from 'node:process';
import { and, eq, inArray, like } from 'drizzle-orm';
import { db } from '../../../src/libs/DB';
import { artifactSchema, askSchema, businessObjectSchema, businessObjectTypeSchema } from '../../../src/models/Schema';

async function main() {
  const title = process.argv[2] ?? 'Northwind — Hiring agents';
  const rooms = await db
    .select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectTypeSchema.slug, 'data_room'), like(businessObjectSchema.title, `${title}%`)));
  const ids = rooms.map(r => r.id);
  if (ids.length === 0) {
    console.warn('[reset-rooms] nothing to remove');
    return;
  }
  await db.delete(askSchema).where(inArray(askSchema.groupKey, ids.map(id => `data-room:${id}`)));
  await db.delete(artifactSchema).where(and(eq(artifactSchema.recordType, 'object'), inArray(artifactSchema.recordId, ids.map(String))));
  await db.delete(businessObjectSchema).where(inArray(businessObjectSchema.id, ids));
  console.warn(`[reset-rooms] removed ${ids.length} room(s): ${ids.join(', ')}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
