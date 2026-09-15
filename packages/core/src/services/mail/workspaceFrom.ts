import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mailboxFrom } from '@/libs/mail/mailbox';
import { projectSchema } from '@/models/Schema';

/**
 * The sender a workspace's outbound mail wears: its own mailbox
 * (`Revenue Team <revenue@agents.example.com>`) when it has one enabled, else
 * nothing — and `sendMail` falls back to the deployment's `VOCION_MAIL_FROM`.
 *
 * One lookup, used by every job that mails on a workspace's behalf (the daily
 * team report, ask notifications), so a reply to a report lands back in the
 * workspace's conversation rather than a shared no-reply address.
 * @param orgId - Tenant (project id).
 */
export async function workspaceFrom(orgId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: projectSchema.name, address: projectSchema.mailboxAddress, enabled: projectSchema.mailboxEnabled })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!row || !row.enabled || !row.address) {
    return undefined;
  }
  return mailboxFrom({ projectName: row.name, address: row.address });
}
