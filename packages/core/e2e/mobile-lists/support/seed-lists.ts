#!/usr/bin/env tsx
import process from 'node:process';
/**
 * seed-lists. Enough rows on every list page for the phone-layout guard
 * (`mobile-lists.spec.ts`) to measure a real first row: open questions on the
 * Review queue with long titles (the founder's phone showed them cut to ten
 * characters), notifications, briefings, conversations and connectors.
 *
 * Idempotent: a rerun removes its own rows first, matched on the markers
 * below. Fictional throughout (`libs/fixtures/realDataGuard.ts`). Prints one
 * JSON line, `{ orgId }`; everything else goes to stderr.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/mobile-lists/support/seed-lists.ts --email a@b.test
 */
import { parseArgs } from 'node:util';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, askSchema, briefingSchema, conversationSchema, notificationSchema, projectSchema, userSchema } from '@/models/Schema';

const MARK = 'e2e-mobile-lists:';

/** Titles long enough that a ten-character cut is obvious, and short enough to fit two lines. */
export const LONG_TITLES = [
  'Create the tracking sheet for the Northwind renewal',
  'Paste the clone URL for the Kestrel Capital repository',
  'Choose the owner for the Contoso Supply onboarding plan',
  'Approve the Bellwater Hall quarterly invoice reminder',
  'Confirm the Acme pilot kickoff date with the team',
];

const { values } = parseArgs({ options: { email: { type: 'string' } } });

async function whoIs(email: string): Promise<{ orgId: string; userId: string }> {
  const [row] = await db
    .select({ projectId: projectSchema.id, userId: userSchema.id })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(eq(userSchema.email, email))
    .limit(1);
  if (!row) {
    throw new Error(`no project for ${email}: seed the user first`);
  }
  return { orgId: row.projectId, userId: row.userId };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

async function main(): Promise<void> {
  if (!values.email) {
    console.error('pass --email <the signed-in admin>');
    process.exit(1);
  }
  const { orgId, userId } = await whoIs(values.email);

  await db.delete(askSchema).where(and(eq(askSchema.orgId, orgId), like(askSchema.sourceRef, `${MARK}%`)));
  await db.delete(notificationSchema).where(and(eq(notificationSchema.orgId, orgId), like(notificationSchema.dedupeKey, `${MARK}%`)));
  await db.delete(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), like(briefingSchema.publishedBy, `${MARK}%`)));
  await db.delete(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), like(conversationSchema.title, 'Mobile list check:%')));

  const kinds = ['input', 'input', 'approval', 'approval', 'ruling'] as const;
  await db.insert(askSchema).values(LONG_TITLES.map((title, i) => ({
    orgId,
    kind: kinds[i]!,
    title,
    sourceRef: `${MARK}${i}`,
    body: 'A fictional question for the phone layout check.',
    agentSlug: 'pipeline-analyst',
    risk: 'low' as const,
    options: kinds[i] === 'input' ? [] : [{ id: 'yes', label: 'Approve', recommended: true }, { id: 'no', label: 'Not now' }],
    createdAt: hoursAgo(24 * (9 - i)),
    updatedAt: hoursAgo(24 * (9 - i)),
  })));

  await db.insert(notificationSchema).values(LONG_TITLES.map((title, i) => ({
    orgId,
    userId,
    kind: 'ask.created',
    title: `New question: ${title}`,
    body: 'Asked by the pipeline analyst in the Northwind workspace.',
    dedupeKey: `${MARK}${i}`,
    createdAt: hoursAgo(i + 1),
  })));

  await db.insert(briefingSchema).values([1, 2, 3, 4].map(d => ({
    orgId,
    title: `Weekly pipeline brief for the Northwind revenue team, week ${40 - d}`,
    content: '## What changed\n\nFour renewals moved forward; one stalled on pricing.',
    publishedBy: `${MARK}${d}`,
    agentSlug: 'pipeline-analyst',
    createdAt: hoursAgo(24 * 7 * d),
  })));

  await db.insert(conversationSchema).values([1, 2, 3].map(i => ({
    orgId,
    projectId: orgId,
    agentSlug: 'pipeline-analyst',
    title: `Mobile list check: which Contoso Supply deals slipped this quarter, part ${i}`,
    titleSource: 'person' as const,
    createdBy: userId,
  })));

  process.stdout.write(`${JSON.stringify({ orgId })}\n`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
