#!/usr/bin/env tsx
/**
 * Find, and with --fix redraft, the pending enroll cards whose copy the voice
 * gate would refuse today.
 *
 * Cards drafted before the gate shipped (ticket 066, 2026-09-19) carry em
 * dashes and banned phrases the gate now stops. With the gate judging only the
 * sends that change (ticket 069) they no longer block a reviewer's per-send
 * regenerate, but every one of them still needs its copy cleaned before it is
 * sent. This does that once, through the same regenerate path a reviewer's
 * "Regenerate all" takes, so the result lands on the same pending run, keeps
 * its history, and is read back off the card like any other redraft.
 *
 * Read-only by default: prints each violating run with what the gate names.
 * `--fix` regenerates them one at a time (each is a model turn; a pass on a
 * card takes seconds to a few minutes) and waits for each to land or fail
 * before moving on, so the box is never asked for forty turns at once.
 *
 *   npm run -s voice:relint -- --org <project id>            # report
 *   npm run -s voice:relint -- --org <project id> --fix      # redraft
 *   npm run -s voice:relint -- --org <project id> --fix --limit 5
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { isRegeneratingFresh } from '@/libs/actions/regenerating';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { voiceRulesFor } from '@/libs/writing/loadVoiceRules';
import { lintSends } from '@/libs/writing/voiceRules';
import { actionRunSchema } from '@/models/Schema';
import 'dotenv/config';

const INSTRUCTION = 'Remove every em dash and en dash from every send and use a comma, a full stop or a colon instead. Remove any phrase the voice rules name. Change nothing else: keep each send\'s meaning, length, ask and order. Do not add a sign-off or a name at the end.';

type Sends = Array<{ step?: number; subject?: string; body?: string }>;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      org: { type: 'string' },
      fix: { type: 'boolean', default: false },
      limit: { type: 'string' },
      by: { type: 'string', default: 'script:relint-pending-enrolls' },
    },
  });
  if (!values.org) {
    console.error('--org <project id> is required');
    process.exit(2);
  }
  const orgId = values.org;
  const limit = values.limit ? Number(values.limit) : Number.POSITIVE_INFINITY;
  const rules = await voiceRulesFor(orgId);

  const rows = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input, regeneratingSince: actionRunSchema.regeneratingSince })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.actionId, 'personalization.enroll'), eq(actionRunSchema.status, 'pending')))
    .orderBy(actionRunSchema.createdAt);

  const violating: Array<{ id: number; input: Record<string, unknown>; report: string; count: number }> = [];
  for (const row of rows) {
    const input = row.input as Record<string, unknown>;
    const { ok, report, count } = lintSends((input.sends as Sends | undefined) ?? [], rules);
    if (!ok) {
      violating.push({ id: row.id, input, report, count });
    }
  }
  console.warn(`${rows.length} pending enroll card(s); ${violating.length} would be refused by the voice gate today.`);
  for (const v of violating) {
    console.warn(`\n#${v.id} (${String(v.input.contactName ?? v.input.contactRef)}): ${v.count} violation(s)\n${v.report}`);
  }
  if (!values.fix || violating.length === 0) {
    return;
  }

  const action = getAction('personalization.enroll');
  if (!action?.regenerate) {
    throw new Error('personalization.enroll does not declare regenerate');
  }
  let done = 0;
  let failed = 0;
  for (const v of violating.slice(0, limit)) {
    const [fresh] = await db.select({ regeneratingSince: actionRunSchema.regeneratingSince }).from(actionRunSchema).where(eq(actionRunSchema.id, v.id)).limit(1);
    if (fresh && isRegeneratingFresh(fresh.regeneratingSince)) {
      console.warn(`#${v.id}: already regenerating, skipped`);
      continue;
    }
    console.warn(`#${v.id}: regenerating…`);
    await db.update(actionRunSchema).set({ regeneratingSince: new Date(), regenerateNote: INSTRUCTION, regenerateError: null }).where(eq(actionRunSchema.id, v.id));
    try {
      await action.regenerate({ orgId, invokedBy: values.by }, v.input as never, v.id, INSTRUCTION, {});
      const [after] = await db.select({ input: actionRunSchema.input }).from(actionRunSchema).where(eq(actionRunSchema.id, v.id)).limit(1);
      const check = lintSends(((after?.input as Record<string, unknown> | undefined)?.sends as Sends | undefined) ?? [], rules);
      console.warn(`#${v.id}: landed, ${check.ok ? 'clean' : `still ${check.count} violation(s)`}`);
      done += 1;
    } catch (err) {
      const failure = err instanceof Error ? err.message : String(err);
      await db.update(actionRunSchema).set({ regeneratingSince: null, regenerateError: failure }).where(eq(actionRunSchema.id, v.id));
      console.warn(`#${v.id}: did not land: ${failure}`);
      failed += 1;
    }
  }
  console.warn(`\n${done} redrafted, ${failed} failed, ${Math.max(0, violating.length - done - failed)} left.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
