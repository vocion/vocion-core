#!/usr/bin/env tsx
/**
 * List the pending proposals filed as the wrong kind of outbound — READ-ONLY.
 *
 * Proposal 8017 (2026-10-09) put a one-to-one reply in front of its reviewer
 * shaped like a HubSpot sequence. The gate now refuses a sequence for anyone
 * in an active thread (`personalization.enroll`'s precheck), but runs filed
 * before it are still pending. This lists them, with the thread each should
 * be answered in, so a person decides what to do with each: decline the
 * enrolment, and let the agent propose the reply.
 *
 * It changes nothing, by design. Re-mapping a pending sequence into a reply
 * draft would invent copy (one reply is not the first of several sends), drop
 * the lead's lane and review back-link, and file a proposal no agent made.
 *
 * It also lists pending reply drafts that named no thread but whose recipient
 * and `Re:` subject match one: those thread on approval now, and are listed
 * so nobody is surprised.
 *
 *   npm run -s sequences:audit -- --org <project id>
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import { activeConversationOf } from '@/libs/actions/personalization-enroll';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';
import { findReplyThread } from '@/services/mail/replyThread';
import 'dotenv/config';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { org: { type: 'string' } } });
  if (!values.org) {
    console.error('--org <project id> is required');
    process.exit(2);
  }
  const orgId = values.org;
  const rows = await db
    .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), inArray(actionRunSchema.actionId, ['personalization.enroll', 'gmail.send'])))
    .orderBy(actionRunSchema.createdAt);

  let misfiled = 0;
  let threading = 0;
  for (const row of rows) {
    const input = (row.input ?? {}) as Record<string, unknown>;
    if (row.actionId === 'personalization.enroll' && typeof input.contactRef === 'string') {
      const thread = await activeConversationOf(orgId, input.contactRef);
      if (thread) {
        misfiled += 1;
        console.warn(`#${row.id} sequence for ${String(input.contactName ?? input.contactRef)} — in an active thread "${thread.subject}" (${thread.threadId}, last ${thread.lastMessageAt ?? 'unknown'}). Decline it; reply in the thread instead.`);
      }
    }
    if (row.actionId === 'gmail.send' && !input.threadId && typeof input.to === 'string') {
      const thread = await findReplyThread(orgId, { to: input.to, subject: typeof input.subject === 'string' ? input.subject : '' });
      if (thread) {
        threading += 1;
        console.warn(`#${row.id} reply to ${input.to} — will thread under "${thread.subject}" (${thread.threadId}) on approval.`);
      }
    }
  }
  console.warn(`\n${rows.length} pending outbound proposal(s): ${misfiled} sequence(s) for someone in a conversation, ${threading} reply draft(s) matched to their thread. Nothing was changed.`);
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
