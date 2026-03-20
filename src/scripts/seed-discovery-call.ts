/**
 * Seed script: creates the "Discovery Call" business object type
 * and a sample instance linked to a real Zoom document.
 *
 * Usage:
 *   npx tsx src/scripts/seed-discovery-call.ts
 *
 * Requires DATABASE_URL in .env.local
 */

import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../models/Schema';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// You must set this to your Clerk org ID
const ORG_ID = process.env.SEED_ORG_ID || '';

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool, schema });

  // Find or create an org
  let orgId = ORG_ID;
  if (!orgId) {
    const orgs = await db.query.organizationSchema.findMany({ limit: 1 });
    if (orgs.length === 0) {
      // Create a seed org for development
      const seedOrgId = 'org_seed_metacto';
      await db
        .insert(schema.organizationSchema)
        .values({ id: seedOrgId })
        .onConflictDoNothing();
      console.log(`Created seed org: ${seedOrgId}`);
      orgId = seedOrgId;
    } else {
      orgId = orgs[0]!.id;
      console.log(`Using existing org: ${orgId}`);
    }
  }

  await seed(db, orgId);

  await pool.end();
}

async function seed(db: ReturnType<typeof drizzle<typeof schema>>, orgId: string) {
  // 1. Upsert "discovery_call" object type
  const existing = await db.query.businessObjectTypeSchema.findFirst({
    where: eq(schema.businessObjectTypeSchema.slug, 'discovery_call'),
  });

  let typeId: number;
  if (existing) {
    console.log(`Object type "discovery_call" already exists (id: ${existing.id})`);
    typeId = existing.id;
  } else {
    const [objType] = await db
      .insert(schema.businessObjectTypeSchema)
      .values({
        orgId,
        slug: 'discovery_call',
        label: 'Discovery Call',
        description: 'Sales discovery call with a prospect — covers needs, budget, timeline, and goals.',
        icon: 'phone',
        schema: {
          type: 'object',
          properties: {
            prospect_name: { type: 'string' },
            prospect_email: { type: 'string' },
            prospect_company: { type: 'string' },
            scheduled_at: { type: 'string', format: 'date-time' },
            hubspot_deal_id: { type: 'string' },
            hubspot_deal_stage: { type: 'string' },
            key_topics: { type: 'array', items: { type: 'string' } },
            next_steps: { type: 'array', items: { type: 'string' } },
          },
        },
      })
      .returning();
    typeId = objType!.id;
    console.log(`Created object type "discovery_call" (id: ${typeId})`);
  }

  // 2. Also create other common types for the demo
  const otherTypes = [
    {
      slug: 'deal',
      label: 'Deal',
      description: 'Sales opportunity or contract negotiation tracked across CRM, email, and documents.',
      icon: 'handshake',
    },
    {
      slug: 'account',
      label: 'Account',
      description: 'Customer or prospect organization spanning CRM, Slack, Drive, and project tools.',
      icon: 'building',
    },
    {
      slug: 'kickoff_call',
      label: 'Kickoff Call',
      description: 'Project kickoff call marking the start of active engagement.',
      icon: 'rocket',
    },
  ];

  for (const t of otherTypes) {
    const exists = await db.query.businessObjectTypeSchema.findFirst({
      where: eq(schema.businessObjectTypeSchema.slug, t.slug),
    });
    if (!exists) {
      await db.insert(schema.businessObjectTypeSchema).values({ orgId, ...t });
      console.log(`Created object type "${t.slug}"`);
    }
  }

  // 3. Create a sample Discovery Call instance linked to a real Zoom document
  const sampleTitle = 'Kevin / Kristen: MetaCTO Discovery Call';
  const existingObj = await db.query.businessObjectSchema.findFirst({
    where: eq(schema.businessObjectSchema.title, sampleTitle),
  });

  if (existingObj) {
    console.log(`Sample discovery call already exists (id: ${existingObj.id})`);
  } else {
    const [obj] = await db
      .insert(schema.businessObjectSchema)
      .values({
        orgId,
        typeId,
        title: sampleTitle,
        status: 'completed',
        metadata: {
          prospect_name: 'Kevin',
          prospect_company: 'Kristen\'s org',
          scheduled_at: '2026-01-13T18:30:00Z',
          key_topics: ['project scope', 'timeline', 'budget', 'goals'],
          next_steps: ['Send capabilities deck', 'Schedule follow-up'],
          hubspot_deal_stage: 'discovery',
        },
        createdBy: 'seed-script',
      })
      .returning();

    console.log(`Created discovery call object (id: ${obj!.id})`);

    // 4. Link the real Zoom document
    await db.insert(schema.objectDocumentLinkSchema).values({
      objectId: obj!.id,
      onyxDocumentId: 'zoom_meeting_84569984849',
      sourceType: 'zoom',
      semanticIdentifier: 'Kevin / Kristen: MetaCTO Discovery Call',
      link: 'https://us06web.zoom.us/rec/play/v-S_sMbtURMz9QP86zhAt_bMbSfxMS3G93vOxQYOjZ61naCBHKo6_9c4ESgD_TzlANo0FAId67HSVJTj.aySc67w4AWbjC855',
      role: 'transcript',
    });

    console.log('  Linked Zoom transcript document');

    // Link additional discovery-related Zoom documents
    const additionalDocs = [
      {
        onyxDocumentId: 'zoom_meeting_84711140132',
        semanticIdentifier: 'Claude Usage Discovery [Garrett]',
        link: '',
        role: 'related_call',
      },
      {
        onyxDocumentId: 'zoom_meeting_84413381027',
        semanticIdentifier: 'Claude Usage Discovery [Chris]',
        link: '',
        role: 'related_call',
      },
    ];

    for (const doc of additionalDocs) {
      await db.insert(schema.objectDocumentLinkSchema).values({
        objectId: obj!.id,
        ...doc,
        sourceType: 'zoom',
      });
      console.log(`  Linked: ${doc.semanticIdentifier}`);
    }
  }

  console.log('\nDone! Visit /dashboard/objects to see the seeded data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
