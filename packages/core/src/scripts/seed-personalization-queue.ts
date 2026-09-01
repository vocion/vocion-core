/**
 * Seeds a realistic personalization queue for local review of the surface:
 * leads across all four lanes, mixed confidence, one brief with gaps and no
 * sequence (the case that must stay reviewable), one fully drafted.
 *
 * Idempotent — contact refs are stable, so re-running upserts.
 *
 * Usage:
 *   npx tsx src/scripts/seed-personalization-queue.ts
 *
 * SEED_ORG_ID selects the org; defaults to the first org in the database.
 */

import dotenv from 'dotenv';
import { and, eq } from 'drizzle-orm';
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

const HOURS = 60 * 60 * 1000;

type Seed = Omit<typeof schema.leadBriefSchema.$inferInsert, 'orgId'>;

const LEADS: Seed[] = [
  {
    contactRef: 'contacts:88201',
    contactName: 'Jamie Smith',
    contactTitle: 'Managing Partner',
    companyName: 'Redpoint IT',
    triggerType: 'new',
    entranceSource: 'ebook',
    utmCampaign: 'msp-triage',
    engagementSent: 2,
    engagementOpened: 2,
    status: 'ready_for_review',
    confidence: 0.88,
    claims: [
      { text: 'Runs a 14-person MSP serving mid-market legal and healthcare clients.', kind: 'company', source: 'redpointit.com/about', date: '2026-08-24' },
      { text: 'Downloaded the MSP triage ebook, then opened both follow-ups within a day.', kind: 'engagement', source: 'hubspot:contacts/88201', date: '2026-08-25' },
      { text: 'Posted twice this month about ticket volume outpacing headcount.', kind: 'signal', source: 'linkedin.com/in/jamiesmith-msp', date: '2026-08-19' },
    ],
    missing: [],
    draftSequence: [
      { step: 1, day: 0, subject: 'Ticket volume at Redpoint', body: 'You grabbed the triage ebook last week, so I\'ll skip the pitch.\n\nMost MSPs your size hit the same wall: volume climbs, the team doesn\'t. Worth 20 minutes to walk through what we did for a 12-person shop in the same spot?' },
      { step: 2, day: 4, subject: 'Following up', body: 'Circling back on this. If the timing is wrong, say so and I\'ll leave it.' },
    ],
    recommendedSequence: { id: 'seq-demo-1', name: 'MSP Triage Nurture', reason: 'The triage ebook is the entrance path, and this nurture is built around it.', senderEmail: 'chris@metacto.com', verified: false },
    mqlAt: new Date(Date.now() - 8 * 24 * HOURS),
    briefedAt: new Date(Date.now() - 2 * HOURS),
  },
  {
    contactRef: 'contacts:88202',
    contactName: 'Sean Parno',
    contactTitle: 'Co-founder & President',
    companyName: 'GLR Inc',
    triggerType: 'new',
    entranceSource: 'ebook',
    utmCampaign: 'ai-construction',
    engagementSent: 2,
    engagementOpened: 2,
    status: 'ready_for_review',
    confidence: 0.86,
    claims: [
      { text: 'Co-founded GLR, a commercial construction firm with roughly 60 field staff.', kind: 'company', source: 'glrinc.com', date: '2026-08-22' },
      { text: 'Entered through the AI-in-construction ebook and opened both sends.', kind: 'engagement', source: 'hubspot:contacts/88202', date: '2026-08-25' },
    ],
    missing: ['No recent public statements on technology plans.'],
    draftSequence: [
      { step: 1, subject: 'The AI piece you downloaded', body: 'You pulled the construction AI ebook last week.\n\nThe part most firms act on first is field reporting, not estimating. Happy to show you what that looked like for a firm about your size.' },
    ],
    briefedAt: new Date(Date.now() - 4 * HOURS),
  },
  {
    contactRef: 'contacts:88203',
    contactName: 'Tomás Bauer',
    contactTitle: 'COO',
    companyName: 'Civic Grid',
    triggerType: 'new',
    entranceSource: 'ebook',
    utmCampaign: 'ai-construction',
    engagementSent: 2,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.82,
    claims: [
      { text: 'COO at Civic Grid, a municipal infrastructure contractor.', kind: 'company', source: 'civicgrid.com/leadership', date: '2026-08-20' },
      { text: 'Opened the first send, not the second.', kind: 'engagement', source: 'hubspot:contacts/88203', date: '2026-08-24' },
    ],
    missing: ['Company size not published.'],
    draftSequence: [],
    briefedAt: new Date(Date.now() - 6 * HOURS),
  },
  {
    contactRef: 'contacts:88204',
    contactName: 'Aisha Serrano',
    contactTitle: 'VP Operations',
    companyName: 'Northgate Facilities',
    triggerType: 'stale',
    entranceSource: 'ebook',
    utmCampaign: 'ai-construction',
    engagementSent: 1,
    engagementOpened: 1,
    status: 'ready_for_review',
    confidence: 0.69,
    claims: [
      { text: 'VP Operations at Northgate, a facilities management group.', kind: 'company', source: 'hubspot:contacts/88204', date: '2026-07-30' },
    ],
    // The reviewable-with-gaps case: thin research must show its holes, not
    // paper over them with a confident-sounding draft.
    missing: [
      'No company website found for Northgate Facilities.',
      'No role confirmation outside the CRM record.',
    ],
    draftSequence: [],
    briefedAt: new Date(Date.now() - 26 * HOURS),
  },
  {
    contactRef: 'contacts:88205',
    contactName: 'Rosa Lindqvist',
    contactTitle: 'Head of Field Ops',
    companyName: 'Meridian Group',
    triggerType: 'stale',
    entranceSource: 'ad',
    utmCampaign: 'agent-workforce',
    engagementSent: 1,
    engagementOpened: 0,
    status: 'ready_for_review',
    confidence: 0.64,
    claims: [
      { text: 'Arrived from the agent-workforce ad, has not opened the first send.', kind: 'engagement', source: 'hubspot:contacts/88205', date: '2026-08-18' },
    ],
    missing: ['No engagement beyond the form fill.'],
    draftSequence: [],
    briefedAt: new Date(Date.now() - 30 * HOURS),
  },
  {
    contactRef: 'contacts:88206',
    contactName: 'Priya Raghunathan',
    contactTitle: 'Director of Engineering',
    companyName: 'Halden Systems',
    triggerType: 'new',
    entranceSource: 'webinar',
    utmCampaign: 'agent-workforce',
    engagementSent: 3,
    engagementOpened: 3,
    status: 'handed_off',
    confidence: 0.91,
    claims: [
      { text: 'Attended the agent workforce webinar and asked two questions about rollout.', kind: 'engagement', source: 'hubspot:contacts/88206', date: '2026-08-21' },
    ],
    missing: [],
    draftSequence: [],
    briefedAt: new Date(Date.now() - 50 * HOURS),
    decidedAt: new Date(Date.now() - 48 * HOURS),
    decidedBy: 'andrew@metacto.com',
  },
  {
    contactRef: 'contacts:88207',
    contactName: 'Dev Okonkwo',
    contactTitle: 'Owner',
    companyName: 'Bright Lane Logistics',
    triggerType: 'stale',
    entranceSource: 'ad',
    utmCampaign: 'msp-triage',
    engagementSent: 1,
    engagementOpened: 0,
    status: 'held',
    confidence: 0.41,
    claims: [],
    missing: ['Could not confirm the company exists at the domain on file.'],
    draftSequence: [],
    briefedAt: new Date(Date.now() - 72 * HOURS),
    decidedAt: new Date(Date.now() - 70 * HOURS),
    decidedBy: 'lili@metacto.com',
  },
  {
    contactRef: 'contacts:88208',
    contactName: 'Marta Kovac',
    contactTitle: 'Chief of Staff',
    companyName: 'Orlin Health',
    triggerType: 'new',
    entranceSource: 'ebook',
    utmCampaign: 'msp-triage',
    engagementSent: 4,
    engagementOpened: 3,
    status: 'sent',
    confidence: 0.84,
    claims: [
      { text: 'Chief of Staff at a 300-bed regional health system.', kind: 'company', source: 'orlinhealth.org/leadership', date: '2026-08-12' },
    ],
    missing: [],
    draftSequence: [
      { step: 1, subject: 'What you flagged in the ebook', body: 'Reaching out after you pulled the triage guide. One question: is intake the bottleneck, or is it what happens after?' },
    ],
    briefedAt: new Date(Date.now() - 96 * HOURS),
    decidedAt: new Date(Date.now() - 94 * HOURS),
    decidedBy: 'andrew@metacto.com',
  },
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool, schema });

  let orgId = process.env.SEED_ORG_ID || '';
  if (!orgId) {
    const orgs = await db.query.organizationSchema.findMany({ limit: 1 });
    if (orgs.length === 0) {
      console.error('No org found — set SEED_ORG_ID or sign in once to create one.');
      process.exit(1);
    }
    orgId = orgs[0]!.id;
  }
  console.log(`Seeding personalization queue for org: ${orgId}`);

  for (const lead of LEADS) {
    const [existing] = await db
      .select({ id: schema.leadBriefSchema.id })
      .from(schema.leadBriefSchema)
      .where(and(
        eq(schema.leadBriefSchema.orgId, orgId),
        eq(schema.leadBriefSchema.contactRef, lead.contactRef),
      ))
      .limit(1);

    const payload = {
      ...lead,
      orgId,
      briefVersion: 'seed#personalization-v0',
      thresholds: { confident: 0.8, uncertain: 0.55 },
      briefedBy: { agentSlug: 'revenue-lead' },
    };

    if (existing) {
      await db.update(schema.leadBriefSchema).set(payload).where(eq(schema.leadBriefSchema.id, existing.id));
    } else {
      await db.insert(schema.leadBriefSchema).values(payload);
    }
  }

  // The fully-drafted lead also gets its pending personalization.enroll run,
  // so both surfaces show the decidable card. Upserted via the dedup key,
  // same as the real propose path.
  const drafted = LEADS[0]!;
  const dedupKey = `personalization.enroll:${drafted.contactRef}`;
  const [leadRow] = await db
    .select({ id: schema.leadBriefSchema.id })
    .from(schema.leadBriefSchema)
    .where(and(eq(schema.leadBriefSchema.orgId, orgId), eq(schema.leadBriefSchema.contactRef, drafted.contactRef)))
    .limit(1);
  const enrollInput = {
    leadBriefId: leadRow!.id,
    contactRef: drafted.contactRef,
    contactName: drafted.contactName,
    companyName: drafted.companyName ?? undefined,
    sequenceId: 'seq-demo-1',
    sequenceName: 'MSP Triage Nurture',
    senderEmail: 'chris@metacto.com',
    sends: drafted.draftSequence!,
  };
  const [existingRun] = await db
    .select({ id: schema.actionRunSchema.id })
    .from(schema.actionRunSchema)
    .where(and(
      eq(schema.actionRunSchema.orgId, orgId),
      eq(schema.actionRunSchema.dedupKey, dedupKey),
      eq(schema.actionRunSchema.status, 'pending'),
    ))
    .limit(1);
  let runId = existingRun?.id;
  if (runId) {
    await db.update(schema.actionRunSchema).set({ input: enrollInput }).where(eq(schema.actionRunSchema.id, runId));
  } else {
    const [inserted] = await db.insert(schema.actionRunSchema).values({
      orgId,
      actionId: 'personalization.enroll',
      input: enrollInput,
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      proposal: { confidence: drafted.confidence ?? undefined, rationale: 'The triage ebook is the entrance path, and this nurture is built around it.' },
      dedupKey,
    }).returning({ id: schema.actionRunSchema.id });
    runId = inserted!.id;
  }
  await db.update(schema.leadBriefSchema).set({ reviewActionRunId: runId }).where(eq(schema.leadBriefSchema.id, leadRow!.id));
  console.log(`Pending personalization.enroll run #${runId} for ${drafted.contactName}.`);

  const lanes = LEADS.reduce<Record<string, number>>((acc, l) => {
    acc[l.status!] = (acc[l.status!] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Seeded ${LEADS.length} leads:`, lanes);
  console.log('Open /gtm/personalization (the surface must be enabled in workspace.yaml).');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
