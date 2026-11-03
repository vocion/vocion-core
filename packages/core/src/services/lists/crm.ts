import type { ListActor } from './service';
import type { CrmKind } from '@/libs/crm/model';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { crmListId } from '@/libs/crm/model';
import { listFieldsSchema } from '@/libs/lists/spec';
import { fromRepoRoot } from '@/libs/repo-root';
import { actAs } from '@/services/workspace/actAs';
import { createList, ListError, readList } from './service';

/**
 * Deterministic IDs make a partial installation resumable without duplicating records.
 * @param actor
 */
export async function installCrm(actor: ListActor) {
  const who = await actAs(actor.userId, actor.orgId);
  if (!who || who.role !== 'admin') {
    throw new ListError('Only an admin can install the workspace CRM.', 403);
  }
  const definitions = z.array(z.object({ key: z.string(), title: z.string(), fields: z.array(z.record(z.string(), z.unknown())) }))
    .parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ fromRepoRoot('packages/core/templates/lists/crm.json'), 'utf8')));
  const ids = Object.fromEntries(definitions.map(d => [d.key, crmListId(actor.orgId, d.key as CrmKind)]));
  const installed = [];
  for (const definition of definitions) {
    const id = ids[definition.key]!;
    try {
      const existing = await readList(actor, { id, limit: 1 });
      if (existing.list.scope !== 'workspace') {
        throw new ListError('CRM List ID is already in use', 409);
      }
      installed.push(existing.list);
      continue;
    } catch (error) {
      if (!(error instanceof ListError) || error.status !== 404) {
        throw error;
      }
    }
    const fields = listFieldsSchema.parse(definition.fields.map(({ target, ...field }) => ({ ...field, ...(typeof target === 'string' ? { referenceListId: ids[target] } : {}) })));
    installed.push(await createList(actor, { id, title: definition.title, scope: 'workspace', fields, purpose: 'CRM starter. Maintained in this workspace; no external synchronization or automatic outreach.' }));
  }
  return { lists: installed.map(list => ({ id: list.id, title: list.title, href: `/dashboard/lists/${list.id}` })), note: 'CRM Lists installed. No reminders, outreach, or external CRM sync were enabled.' };
}
