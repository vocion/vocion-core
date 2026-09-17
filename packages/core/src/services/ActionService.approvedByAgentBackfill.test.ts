/**
 * The backfill in migration 0108, run against PGlite.
 *
 * Before `approved_by_agent` existed, the only record that the trust ladder had
 * released a run was an `autoApproved` key inside the `proposal` envelope. The
 * migration copies that onto the column so the auto-approved audit list can ask
 * one indexed question instead of falling back to reading a jsonb key — a
 * fallback that cost the list its index and scanned every action run the org
 * had.
 *
 * The statement is read out of the migration file rather than retyped here. A
 * copy would keep passing after someone edited the migration, which is the one
 * failure this test exists to catch.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { sql, eq } = await import('drizzle-orm');

const ORG = 'org_approved_by_agent_backfill';

const MIGRATION = path.join(
  process.cwd(),
  'migrations',
  '0108_action_run_approved_by_agent.sql',
);

/**
 * The backfill statement, taken from the migration file itself.
 *
 * The file is a list of statements separated by drizzle's
 * `--> statement-breakpoint` marker; the backfill is the one that updates.
 */
function backfillStatement(): string {
  const statements = readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint');
  const update = statements.find(statement => /^\s*UPDATE/m.test(statement));
  if (!update) {
    throw new Error(`No UPDATE statement in ${MIGRATION} — has the backfill been removed?`);
  }
  return update;
}

async function insertRun(overrides: Record<string, unknown>): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'crm.update',
      input: { field: 'value' },
      status: 'done',
      ...overrides,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function readApprovedByAgent(runId: number): Promise<boolean | null> {
  const [row] = await db
    .select({ approvedByAgent: actionRunSchema.approvedByAgent })
    .from(actionRunSchema)
    .where(eq(actionRunSchema.id, runId));
  return row!.approvedByAgent;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('migration 0108 backfill', () => {
  it('claims a pre-column run the ladder released, so the audit list keeps it', async () => {
    const legacy = await insertRun({ proposal: { confidence: 0.99, autoApproved: true } });

    await db.execute(sql.raw(backfillStatement()));

    expect(await readApprovedByAgent(legacy)).toBe(true);
  });

  it('leaves a run the ladder did not release undecided, rather than claiming the whole table', async () => {
    const waiting = await insertRun({ status: 'pending', proposal: { confidence: 0.4 } });
    const declined = await insertRun({ proposal: { confidence: 0.4, autoApproved: false } });

    await db.execute(sql.raw(backfillStatement()));

    expect(await readApprovedByAgent(waiting)).toBeNull();
    expect(await readApprovedByAgent(declined)).toBeNull();
  });

  it('never overwrites an answer the column already carries', async () => {
    // A person's `false` beside a stale envelope key is the case that matters:
    // overwriting it would report a human decision as the agent's work.
    const humanDecided = await insertRun({
      approvedByAgent: false,
      proposal: { autoApproved: true },
    });

    await db.execute(sql.raw(backfillStatement()));

    expect(await readApprovedByAgent(humanDecided)).toBe(false);
  });

  it('can run twice, because a migration that half-applied will be run again', async () => {
    const legacy = await insertRun({ proposal: { autoApproved: true } });

    await db.execute(sql.raw(backfillStatement()));
    await db.execute(sql.raw(backfillStatement()));

    expect(await readApprovedByAgent(legacy)).toBe(true);
  });
});
