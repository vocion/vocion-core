import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

/** Generic writes and CRM mutations can trigger remote mail automations too. */
const DELIVERY_ACTIONS = new Set(['personalization.enroll', 'hubspot.create', 'hubspot.update', 'rest.request', 'mcp.call']);

export async function assertOutboundAllowed(orgId: string, action: { id: string; grant: string }, input: Record<string, unknown>) {
  const mail = action.grant === 'send_email' || action.id === 'gmail.send';
  if (!mail && !DELIVERY_ACTIONS.has(action.id)) {
    return;
  }
  // Gmail drafts do not dispatch mail; the execution-time input is checked,
  // so changing a reviewed draft into a send cannot bypass this hold.
  if (action.id === 'gmail.send' && input.draft === true) {
    return;
  }
  const [project] = await db.select({ dryRun: projectSchema.outboundDryRun }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!project || project.dryRun) {
    throw new Error('Outbound delivery is held in dry run. Save and review drafts in Vocion. Email sends, sequence enrollment and external CRM writes remain blocked until the workspace cutover is completed.');
  }
}
