/**
 * Demo sandbox object seeding — two object types (account, deal) and a
 * small, coherent book of business for Acme RevOps, so recorded agent
 * turns ground in real records instead of "no data yet."
 *
 * Idempotent-ish: skips if the account type already exists.
 *
 *   DATABASE_URL=pglite://$PWD/demo/seed-db npx tsx demo/seed-objects.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '../src/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '../src/models/Schema';

const ORG = 'proj-44fd9c02-64d1-4099-b33b-1d7b6bbd1462';

async function main(): Promise<void> {
  const existing = await db.select({ id: businessObjectTypeSchema.id })
    .from(businessObjectTypeSchema)
    .where(eq(businessObjectTypeSchema.slug, 'account'));
  if (existing.length > 0) {
    console.warn('object types already seeded; skipping');
    return;
  }

  const [accountType] = await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    projectId: ORG,
    slug: 'account',
    label: 'Account',
    description: 'A customer or prospect company.',
    icon: 'building',
    schema: {
      type: 'object',
      properties: {
        industry: { type: 'string' },
        arr: { type: 'number', description: 'annual recurring revenue, USD' },
        health: { type: 'string', enum: ['green', 'yellow', 'red'] },
        renewal_date: { type: 'string', format: 'date' },
        owner: { type: 'string' },
      },
    },
  }).returning({ id: businessObjectTypeSchema.id });

  const [dealType] = await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    projectId: ORG,
    slug: 'deal',
    label: 'Deal',
    description: 'An open opportunity in the pipeline.',
    icon: 'handshake',
    schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        stage: { type: 'string', enum: ['discovery', 'evaluation', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] },
        amount: { type: 'number' },
        close_date: { type: 'string', format: 'date' },
        next_step: { type: 'string' },
        risk: { type: 'string' },
        owner: { type: 'string' },
      },
    },
  }).returning({ id: businessObjectTypeSchema.id });

  const accounts: Array<[string, Record<string, unknown>, string]> = [
    ['Northwind Logistics', { industry: 'Logistics', arr: 86000, health: 'green', renewal_date: '2027-01-15', owner: 'pat@acme.test' }, 'Mid-market 3PL. Expanded to a second warehouse team in Q2; strong champion in ops.'],
    ['Beacon Health', { industry: 'Healthcare', arr: 124000, health: 'yellow', renewal_date: '2026-10-30', owner: 'pat@acme.test' }, 'Regional provider network. Renewal approaching; procurement asked for a usage review in August.'],
    ['Radley Manufacturing', { industry: 'Manufacturing', arr: 47000, health: 'green', renewal_date: '2027-03-01', owner: 'alex@acme.test' }, 'Family-owned fabricator. Slow adopters but very sticky; CFO loves the reporting.'],
    ['Corvus Media', { industry: 'Media', arr: 32000, health: 'red', renewal_date: '2026-09-20', owner: 'alex@acme.test' }, 'Agency group. Sponsor left in July; usage down 40% since. Renewal at risk.'],
    ['Summit Facilities', { industry: 'Facilities services', arr: 58000, health: 'green', renewal_date: '2027-02-10', owner: 'pat@acme.test' }, 'National janitorial + maintenance. Piloting a second department after a strong Q2 QBR.'],
    ['Harbor & Finch', { industry: 'Professional services', arr: 0, health: 'yellow', renewal_date: '', owner: 'alex@acme.test' }, 'Boutique consultancy, active prospect. Two discovery calls done; waiting on security questionnaire.'],
  ];
  for (const [title, metadata, summary] of accounts) {
    await db.insert(businessObjectSchema).values({
      orgId: ORG,
      projectId: ORG,
      typeId: accountType!.id,
      title,
      status: 'active',
      metadata,
      summary,
      createdBy: 'demo-seed',
    });
  }

  const deals: Array<[string, Record<string, unknown>, string]> = [
    ['Beacon Health — expansion to claims team', { account: 'Beacon Health', stage: 'proposal', amount: 62000, close_date: '2026-09-26', next_step: 'Proposal review call Thursday; bring the usage report', risk: 'Procurement wants a usage review before renewal + expansion are combined', owner: 'pat@acme.test' }, 'Expansion opportunity tied to the October renewal. Champion is strong; procurement is the gate.'],
    ['Harbor & Finch — new business', { account: 'Harbor & Finch', stage: 'evaluation', amount: 38000, close_date: '2026-10-15', next_step: 'Return the security questionnaire; schedule technical review', risk: 'Security review could add 3-4 weeks', owner: 'alex@acme.test' }, 'Two strong discovery calls. Decision maker engaged; security review is the long pole.'],
    ['Northwind Logistics — warehouse team #3', { account: 'Northwind Logistics', stage: 'negotiation', amount: 24000, close_date: '2026-09-12', next_step: 'Send the multi-team pricing addendum', risk: 'Low', owner: 'pat@acme.test' }, 'Third team expansion; commercial terms nearly agreed.'],
    ['Corvus Media — renewal save', { account: 'Corvus Media', stage: 'discovery', amount: 32000, close_date: '2026-09-20', next_step: 'Exec-to-exec call to re-establish sponsor', risk: 'HIGH: champion departed, usage down 40%', owner: 'alex@acme.test' }, 'Renewal-save motion. Needs a new sponsor before the Sep 20 renewal.'],
    ['Summit Facilities — second department', { account: 'Summit Facilities', stage: 'evaluation', amount: 41000, close_date: '2026-11-05', next_step: 'Scope workshop with the maintenance leadership', risk: 'Budget cycle starts Oct 1; slipping past it risks a quarter delay', owner: 'pat@acme.test' }, 'Pilot went well; expansion scoped to maintenance division.'],
    ['Radley Manufacturing — reporting add-on', { account: 'Radley Manufacturing', stage: 'proposal', amount: 9000, close_date: '2026-09-30', next_step: 'CFO wants a one-page ROI summary', risk: 'Low', owner: 'alex@acme.test' }, 'Small add-on; CFO-driven.'],
    ['Meridian Dental — new business', { account: 'Meridian Dental (prospect)', stage: 'discovery', amount: 27000, close_date: '2026-11-20', next_step: 'Follow up after last week\'s pricing call — went quiet', risk: 'No response in 9 days after pricing was shared', owner: 'pat@acme.test' }, 'Multi-location dental group. Strong first call, quiet since pricing.'],
    ['Atlas Field Services — new business', { account: 'Atlas Field Services (prospect)', stage: 'evaluation', amount: 55000, close_date: '2026-10-31', next_step: 'Reference call with Northwind ops lead', risk: 'Competing with an incumbent spreadsheet process', owner: 'alex@acme.test' }, 'Field-service operator; wants proof from a similar customer.'],
  ];
  for (const [title, metadata, summary] of deals) {
    await db.insert(businessObjectSchema).values({
      orgId: ORG,
      projectId: ORG,
      typeId: dealType!.id,
      title,
      status: 'active',
      metadata,
      summary,
      createdBy: 'demo-seed',
    });
  }

  console.warn(`seeded ${accounts.length} accounts + ${deals.length} deals`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
