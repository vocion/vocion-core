import type { RuntimeContext } from '../types';
import type { ListActor } from '@/services/lists/service';
import { readFileSync } from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { aggregateListSchema, configureListSchema, createListSchema, ListValidationError, readListSchema, writeListSchema } from '@/libs/lists/spec';
import { fromRepoRoot } from '@/libs/repo-root';
import { installCrm } from '@/services/lists/crm';
import { aggregateList, configureList, createList, ListError, listLists, readList, writeListRecords } from '@/services/lists/service';
import { memberWorkspace } from '@/services/WorkspaceAccessService';

/**
 * Tools use the signed-in person's identity, never a model-supplied owner or role.
 * @param ctx
 */
export function listTools(ctx: RuntimeContext) {
  if (!ctx.userId) {
    return [];
  }
  const userId = ctx.userId;
  async function answer(run: (actor: ListActor) => Promise<unknown>) {
    try {
      const workspace = await memberWorkspace(userId, ctx.orgId);
      const actor = { orgId: ctx.orgId, userId, personalAccess: workspace?.kind === 'personal' };
      return JSON.stringify({ ok: true, result: await run(actor) });
    } catch (error) {
      return JSON.stringify({ ok: false, error: error instanceof ListError || error instanceof ListValidationError || error instanceof z.ZodError ? error.message : 'List operation failed; read it again before retrying' });
    }
  }
  return [
    tool(async args => answer(async actor => ({ ...await listLists(actor, args.offset), guide: readFileSync(/* turbopackIgnore: true */ fromRepoRoot('packages/core/templates/base/skills/manage-lists/SKILL.md'), 'utf8') })), {
      name: 'list_lists',
      description: 'Find saved personal and shared Lists in this workspace, and read the List-building skill. Start here for lead lists, follow-ups, plans or a CRM. Lists persist until archived. Personal Lists are available through the personal assistant only; shared chat can read workspace Lists. Personal data must not enter shared chat or its activity log.',
      schema: z.object({ offset: z.number().int().min(0).default(0) }),
    }),
    tool(async args => answer(async (actor) => {
      const list = await createList(actor, args);
      return { ...list, href: `/dashboard/lists/${list.id}`, note: 'Saved editable List. Use write_list_records to populate it.' };
    }), { name: 'create_list', description: 'Create a durable typed List, personal by default. Admins may create a workspace List visible to all workspace members. Reuse the request UUID on retries. No deployment required.', schema: createListSchema }),
    tool(async args => answer(actor => readList(actor, args)), { name: 'read_list', description: 'Read a saved List, its schema, current version, paginated records and recent history. Use its version for writes. Optional named view and equality filters.', schema: readListSchema }),
    tool(async args => answer(actor => writeListRecords(actor, args)), { name: 'write_list_records', description: 'Insert or update up to 100 records atomically in a List. Use stable UUIDs, declared fields and the latest List version. Existing records are patched. A conflict changes nothing; re-read before reconciling. A follow-up row does not send a message or schedule a reminder.', schema: writeListSchema }),
    tool(async args => answer(actor => configureList(actor, args)), { name: 'configure_list', description: 'Rename, add fields, save filtered views, archive/restore, or publish your personal List to the workspace. Shared schema changes and publication require admin. Publication exposes all records and history to workspace members, preserves IDs, and must be explicitly requested. Existing field types cannot be changed.', schema: configureListSchema }),
    tool(async args => answer(actor => aggregateList(actor, args)), { name: 'aggregate_list', description: 'Count and sum across ALL matching records in a List, optionally grouped by a field. Up to 500 groups; truncation is explicit. For currency amounts, group or filter by currency before summing.', schema: aggregateListSchema }),
    tool(async () => answer(actor => installCrm(actor)), { name: 'install_crm', description: 'Admin only: install a workspace CRM starter of linked Companies, Contacts, Deals and Follow-ups Lists. Reuses existing starter Lists on retry. No external sync, reminders or outreach are enabled.', schema: z.object({}) }),
  ];
}
