/**
 * records.settle_intake — what the person chose for the items list intake
 * could not settle on its own (`services/intake/intake.ts`).
 *
 * The Decision `extract_records` raises ("2 unreadable · 3 already in HubSpot
 * — merge?") carries the held items whole on each option, so choosing one is
 * this action with the choice:
 *
 *   - `merge` — a person already on file gets the empty fields filled from
 *     what was read (nothing they wrote is overwritten); a contact a CRM sync
 *     mirrored gets a record of the type linked to it by the CRM's own key;
 *     an item the reader was unsure of is added as read.
 *   - `add`   — every item becomes its own record.
 *
 * Unreadable files are never on an option: there is nothing to write until
 * the person sends a clearer copy. Every record carries the provenance the
 * read gave it. Reversible: Undo removes what was added and puts back what was
 * filled.
 */

import type { Action } from './types';
import { z } from 'zod';
import { SETTLE_INTAKE_ACTION } from '@/services/intake/intake';

export const SETTLE_INTAKE_ID = SETTLE_INTAKE_ACTION;

const item = z.object({
  key: z.string().min(1).max(80),
  reason: z.enum(['uncertain', 'duplicate', 'unreadable']),
  label: z.string().min(1).max(200),
  values: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  match: z.record(z.string(), z.unknown()).optional(),
});

const input = z.object({
  objectType: z.string().min(1).max(200),
  roomId: z.number().int().positive().optional(),
  batch: z.string().min(1).max(400),
  conversationId: z.number().int().positive().nullable().optional(),
  items: z.array(item).min(1).max(150),
  choice: z.enum(['merge', 'add']),
});

type Input = z.infer<typeof input>;
type Match = { kind?: string; recordId?: number; system?: string; externalId?: string; title?: string };

/**
 * One line for each choice, for the card and the log.
 * @param i - The input.
 */
function describe(i: Input): string {
  const live = i.items.filter(x => x.reason !== 'unreadable');
  const dupes = live.filter(x => x.reason === 'duplicate').length;
  return i.choice === 'merge'
    ? `Merge ${dupes} into what is on file${live.length > dupes ? `, add ${live.length - dupes}` : ''}`
    : `Add ${live.length} as new ${live.length === 1 ? 'record' : 'records'}`;
}

export const recordsSettleIntakeAction: Action<typeof input> = {
  id: SETTLE_INTAKE_ID,
  name: 'Settle what intake held back',
  description: 'Merge records read from dropped files into the records or CRM contacts they match, or add them as new — the options of the Decision extract_records raises. Reversible.',
  inputSchema: input,
  grant: 'update_object',
  external: false,
  dedupKeyFor: i => `${SETTLE_INTAKE_ID}:${i.batch}:${i.choice}`,
  async reviewCard(_ctx, i) {
    return {
      title: describe(i),
      system: 'Records',
      fields: i.items.slice(0, 12).map(x => ({ label: x.label, value: x.reason === 'duplicate' ? `already there${(x.match as Match | undefined)?.title ? ` as ${(x.match as Match).title}` : ''}` : x.reason === 'uncertain' ? 'unsure' : 'unreadable' })),
      nextAction: i.choice === 'merge' ? 'Approving fills empty fields on what is on file and adds the rest; Undo puts it back.' : 'Approving adds each as its own record; Undo removes them.',
      verbs: { approve: i.choice === 'merge' ? 'Merge' : 'Add', reject: 'Leave them out' },
    };
  },
  async execute(ctx, i) {
    const { mergeIntoRecord, writeIntakeRecord } = await import('@/services/intake/intake');
    const actor = ctx.reviewedBy ?? ctx.origin?.userId ?? ctx.invokedBy ?? 'system';
    const created: Array<{ id: number; title: string; href: string }> = [];
    const merged: Array<{ id: number; title: string; filled: string[]; before: { metadata: Record<string, unknown>; provenance: Record<string, unknown> | null } }> = [];
    const skipped: string[] = [];
    for (const x of i.items) {
      if (x.reason === 'unreadable' || !x.values || Object.keys(x.values).length === 0) {
        skipped.push(x.label);
        continue;
      }
      const provenance = (x.provenance ?? { intake: { batch: i.batch, roomId: i.roomId ?? null, at: new Date().toISOString(), by: actor }, sources: [], fields: {} }) as never;
      const match = x.match as Match | undefined;
      if (i.choice === 'merge' && match?.kind === 'record' && typeof match.recordId === 'number') {
        const done = await mergeIntoRecord({ orgId: ctx.orgId, recordId: match.recordId, values: x.values, provenance });
        if (done) {
          merged.push(done);
          continue;
        }
      }
      const externalKey = i.choice === 'merge' && match?.kind === 'crm' && match.system && match.externalId ? { system: match.system, id: match.externalId } : undefined;
      const written = await writeIntakeRecord({ orgId: ctx.orgId, typeSlug: i.objectType, title: x.label, values: x.values, provenance, actor, conversationId: i.conversationId ?? ctx.origin?.conversationId ?? null, externalKey });
      if (written.created) {
        created.push({ id: written.id, title: written.title, href: written.href });
      } else {
        merged.push({ id: written.id, title: written.title, filled: Object.keys(x.values), before: { metadata: {}, provenance: null } });
      }
    }
    const parts = [
      created.length ? `added ${created.length}` : null,
      merged.length ? `merged ${merged.length}` : null,
      skipped.length ? `left out ${skipped.length}` : null,
    ].filter(Boolean);
    return {
      created,
      merged,
      skipped,
      record: created[0] ? { type: i.objectType, id: created[0].id } : merged[0] ? { type: i.objectType, id: merged[0].id } : null,
      line: `${parts.join(', ') || 'nothing to write'}.`,
    };
  },
  async undo(ctx, _i, result) {
    const { deleteBusinessObject } = await import('@/services/BusinessObjectService');
    const [{ and, eq }, { db }, { businessObjectSchema }] = await Promise.all([import('drizzle-orm'), import('@/libs/DB'), import('@/models/Schema')]);
    const created = (result?.created ?? []) as Array<{ id: number }>;
    const merged = (result?.merged ?? []) as Array<{ id: number; before: { metadata: Record<string, unknown>; provenance: Record<string, unknown> | null } }>;
    for (const c of created) {
      await deleteBusinessObject(c.id, ctx.orgId);
    }
    for (const m of merged) {
      if (Object.keys(m.before.metadata).length === 0 && m.before.provenance === null) {
        continue;
      }
      await db.update(businessObjectSchema).set({ metadata: m.before.metadata, provenance: m.before.provenance }).where(and(eq(businessObjectSchema.orgId, ctx.orgId), eq(businessObjectSchema.id, m.id)));
    }
    return { line: `Removed ${created.length}, put back ${merged.length}.` };
  },
};
