#!/usr/bin/env tsx
import process from 'node:process';
/**
 * seed-sequence-review. A four-send enrollment waiting in the review queue,
 * for the approve-each-send spec (`approve-each-send.queue.spec.ts`).
 *
 * Four sends because that is the case the walk exists for: the plan's whole
 * complaint is that a four-send sequence was approved in one click.
 *
 * Three modes, all against the database the running app is pointed at:
 *
 *   (default)      Inserts one pending `personalization.enroll` run into the
 *                  project the named admin belongs to, and prints one JSON
 *                  line: `{ orgId, runId }`.
 *
 *   --read <id>    Prints the run's record columns as JSON:
 *                  `{ status, sends, revisions, contentReview }`. This is the
 *                  probe the acceptance criteria call for — "what is actually
 *                  on the row", read through the app's own database client
 *                  rather than through the API's report of itself, and
 *                  without shelling out to psql (CI has no docker daemon and
 *                  its database may be an in-memory PGlite).
 *
 *   --clean        Removes the runs this script created.
 *
 * Idempotent: a rerun removes its own earlier rows first, matched on the
 * fixed dedup key below, so the spec stays repeatable against one database.
 *
 * Everything that is not the answer goes to stderr, so the last stdout line
 * is always the one the spec parses.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-sequence-review.ts --email a@b.test
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-sequence-review.ts --read 42
 */
import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  actionRunSchema,
  projectSchema,
  userSchema,
} from '@/models/Schema';

const DEDUP_KEY = 'e2e:approve-each-send';

/** The four sends the spec walks. Fictional throughout (`libs/fixtures/realDataGuard.ts`). */
const SENDS = [
  { step: 1, day: 0, subject: 'Tideline\'s live-ops hiring', body: 'Rowan, your careers page lists two live-ops engineers beside the new studio launch.' },
  { step: 2, day: 3, subject: 'Following up on the launch window', body: 'The launch window is the part most studios underestimate.' },
  { step: 3, day: 6, subject: 'Re: Tideline\'s AI/Automation line', body: 'Rowan, one more note. Apologies for the nudge. If the automation side is already sorted, no worries at all.' },
  { step: 4, day: 10, subject: 'Closing the loop', body: 'Last one from me. Worth twenty minutes next week?' },
];

const { values } = parseArgs({
  options: { email: { type: 'string' }, read: { type: 'string' }, clean: { type: 'boolean' }, count: { type: 'string' }, longName: { type: 'boolean' } },
});

/**
 * The project the named user belongs to — the one their session will be scoped to.
 * @param email
 */
async function orgOf(email: string): Promise<string> {
  const [row] = await db
    .select({ projectId: projectSchema.id })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(eq(userSchema.email, email))
    .limit(1);
  if (!row) {
    throw new Error(`no project for ${email} — seed the user first`);
  }
  return row.projectId;
}

/** The script's work, wrapped: this tree's tsx transform has no top-level await. */
async function main(): Promise<void> {
  if (values.read) {
    const [row] = await db
      .select({
        status: actionRunSchema.status,
        input: actionRunSchema.input,
        revisions: actionRunSchema.revisions,
        contentReview: actionRunSchema.contentReview,
      })
      .from(actionRunSchema)
      .where(eq(actionRunSchema.id, Number(values.read)))
      .limit(1);
    const sends = (row?.input as { sends?: Array<{ step: number; subject?: string; body: string }> })?.sends ?? [];
    // `process.stdout.write`, not console.log: the spec parses the last
    // stdout line, and everything else here goes to stderr (same reason
    // `seed-dedup-fixtures.ts` does it).
    process.stdout.write(`${JSON.stringify({
      status: row?.status ?? null,
      sends,
      revisions: row?.revisions ?? [],
      contentReview: row?.contentReview ?? {},
    })}\n`);
    process.exit(0);
  }

  const email = values.email;
  if (!email) {
    console.error('pass --email <the signed-in admin>');
    process.exit(1);
  }
  const orgId = await orgOf(email);

  // Its own earlier rows first, so a rerun never walks a stale one.
  const { like } = await import('drizzle-orm');
  await db.delete(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), like(actionRunSchema.dedupKey, `${DEDUP_KEY}%`)));

  if (values.clean) {
    console.error('[seed-sequence-review] cleaned');
    process.exit(0);
  }

  // `--count` fills the queue so the header renders a position and an Up-next
  // entry; `--longName` gives the first card the long record name that made
  // the title wrap onto three lines on the live queue.
  const count = Math.max(1, Number(values.count ?? 1));
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const first = i === 0;
    const [run] = await db
      .insert(actionRunSchema)
      .values({
        orgId,
        actionId: 'personalization.enroll',
        status: 'pending',
        dedupKey: `${DEDUP_KEY}:${i}`,
        invokedBy: 'agent:revenue-lead',
        input: {
          contactRef: `contacts:8820${i}`,
          contactName: first && values.longName ? 'Marisol Okonkwo-Vasquez' : `Rowan Pike ${i + 1}`,
          companyName: first && values.longName ? 'Northwind Logistics Group (Pvt.) Limited' : 'Tideline Gaming',
          sequenceId: 'seq-e2e-nurture',
          sequenceName: first ? 'Ebook Inbound Nurture' : 'New Operational AI Inbound Sequence',
          sends: SENDS,
        },
        proposal: {
          confidence: 0.62,
          rationale: 'The careers page names two live-ops roles beside a studio launch.',
          evidence: ['https://tideline.example/careers'],
          agentSlug: 'revenue-lead',
        },
      })
      .returning({ id: actionRunSchema.id });
    ids.push(run!.id);
  }

  console.error(`[seed-sequence-review] ${ids.length} run(s) in ${orgId}`);
  process.stdout.write(`${JSON.stringify({ orgId, runId: ids[0], runIds: ids })}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[seed-sequence-review] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
