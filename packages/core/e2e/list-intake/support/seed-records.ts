/**
 * What the workspace already holds before the badges arrive: Rowan Pike as a
 * Lead someone wrote by hand, and Dana Reyes as a contact a CRM sync mirrored.
 * Idempotent. Run through `dotenv -c` like the other e2e seeders. Fictional.
 */
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectSchema, businessObjectTypeSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

async function main(): Promise<void> {
  const [agent] = await db.select({ orgId: agentSchema.orgId }).from(agentSchema).where(eq(agentSchema.slug, 'revenue-lead')).limit(1);
  if (!agent) {
    throw new Error('apply the list-intake workspace first');
  }
  const orgId = agent.orgId;
  const [type] = await db.select().from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'lead')));
  if (!type) {
    throw new Error('the workspace has no lead type');
  }
  const [rowan] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.title, 'Rowan Pike')));
  if (!rowan) {
    await db.insert(businessObjectSchema).values({ orgId, typeId: type.id, title: 'Rowan Pike', metadata: { name: 'Rowan Pike', email: 'rowan@tideline.example', company: 'Tideline Gaming Marketing' } });
  }
  let [src] = await db.select().from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, 'hubspot')));
  if (!src) {
    [src] = await db.insert(knowledgeSourceSchema).values({ orgId, slug: 'hubspot', configJson: { _connector: 'hubspot' } }).returning();
  }
  const [dana] = await db.select({ id: knowledgeDocumentSchema.id }).from(knowledgeDocumentSchema).where(and(eq(knowledgeDocumentSchema.orgId, orgId), eq(knowledgeDocumentSchema.externalId, 'contacts:5101')));
  if (!dana) {
    await db.insert(knowledgeDocumentSchema).values({ orgId, sourceId: src!.id, externalId: 'contacts:5101', title: 'Dana Reyes', contentHash: 'e2e-dana', metadata: { objectType: 'contacts', primaryEmail: 'dana@kestrel.example', company: 'Kestrel Capital' } });
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
