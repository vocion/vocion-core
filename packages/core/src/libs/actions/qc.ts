/**
 * Quality-control decisions on an `inspection` object, and the loop back to
 * the training set. All four are `external: true`, so an agent proposing one
 * lands in the review queue — a person decides whether a kit is held,
 * released or sent to rework, and whether a photo becomes a training example.
 *
 *   qc.hold             — keep the kit off the truck; records the reason.
 *   qc.release          — a person overrides a hold or confirms a pass.
 *   qc.request_rework   — send the kit back with a note (the note is stored;
 *                         nothing is emailed — the demo stubs the send).
 *   dataset.add_example — copy the photo into templates/<id>/<good|bad>/ in
 *                         S3 so the next training run learns from the
 *                         decision. Live write to the bucket.
 *
 * The review card carries the photo (content kind `image`) plus the model's
 * findings, so the reviewer decides on the picture, not a description of it.
 */

import type { Action, ReviewCard } from './types';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { copyObject, objectExists } from '@/libs/aws/s3';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { updateBusinessObject } from '@/services/BusinessObjectService';

type Finding = { region?: string; issue?: string; expected?: string; observed?: string; severity?: string; confidence?: number };

async function loadInspection(orgId: string, id: number) {
  const obj = await db.query.businessObjectSchema.findFirst({
    where: and(eq(businessObjectSchema.id, id), eq(businessObjectSchema.orgId, orgId)),
    with: { type: true },
  });
  if (!obj) {
    throw new Error(`Inspection #${id} not found`);
  }
  return obj;
}

function meta(obj: { metadata: Record<string, unknown> | null }): Record<string, unknown> {
  return obj.metadata ?? {};
}

function findingLines(m: Record<string, unknown>): string[] {
  const f = Array.isArray(m.findings) ? (m.findings as Finding[]) : [];
  return f.map(x => `${x.region ?? 'region'}: ${x.issue ?? 'issue'}${x.expected ? ` — expected ${x.expected}` : ''}${x.observed ? `, saw ${x.observed}` : ''}`);
}

async function card(orgId: string, id: number, opts: { title: string; headline: string; detail?: string; approve: string; extra?: Array<{ label: string; value: string }> }): Promise<ReviewCard> {
  const obj = await loadInspection(orgId, id);
  const m = meta(obj);
  const lines = findingLines(m);
  return {
    title: opts.title,
    system: 'Kit verification',
    subject: { name: obj.title, company: typeof m.template_id === 'string' ? m.template_id : undefined, href: `/dashboard/objects/${obj.id}` },
    provenance: [
      ...(typeof m.production_order === 'string' ? [{ label: 'Production order', value: m.production_order }] : []),
      ...(typeof m.captured_at === 'string' ? [{ label: 'Captured', value: m.captured_at }] : []),
      ...(typeof m.confidence === 'number' ? [{ label: 'Model confidence', value: `${Math.round(m.confidence * 100)}%` }] : []),
    ],
    recommendation: { headline: opts.headline, detail: opts.detail ?? (typeof m.explanation === 'string' ? m.explanation : undefined) },
    contentHeading: { label: 'Pack-station photo', meta: lines.length ? `${lines.length} finding${lines.length === 1 ? '' : 's'}` : 'no findings' },
    content: typeof m.image_url === 'string'
      ? [{ kind: 'image', id: 'photo', label: obj.title, url: m.image_url, caption: typeof m.explanation === 'string' ? m.explanation : undefined, findings: lines }]
      : [],
    fields: [
      { label: 'Verdict', value: String(m.verdict ?? obj.status) },
      ...lines.map((l, i) => ({ label: `Finding ${i + 1}`, value: l })),
      ...(opts.extra ?? []),
    ],
    links: [{ label: 'Open inspection', href: `/dashboard/objects/${obj.id}` }],
    verbs: { approve: opts.approve, reject: 'Decline' },
  };
}

const decisionStamp = (ctx: { invokedBy?: string; reviewedBy?: string }, action: string, reason: string) => ({
  action,
  reason,
  proposed_by: ctx.invokedBy ?? null,
  decided_by: ctx.reviewedBy ?? ctx.invokedBy ?? null,
  at: new Date().toISOString(),
});

const holdInput = z.object({
  inspection_id: z.coerce.number().int().positive(),
  reason: z.string().min(1),
});

export const qcHoldAction: Action<typeof holdInput> = {
  id: 'qc.hold',
  name: 'Hold kit',
  description: 'Hold a kit at the pack station — it does not ship until a person releases it or sends it to rework. Input: { inspection_id, reason }.',
  inputSchema: holdInput,
  grant: 'qc_decide',
  external: true,
  dedupKeyFor: input => `qc:${input.inspection_id}:qc.hold`,
  reviewCard: (ctx, input) => card(ctx.orgId, input.inspection_id, { title: 'Hold this kit?', headline: 'Hold — keep it off the truck', detail: input.reason, approve: 'Confirm hold' }),
  async execute(ctx, input) {
    const obj = await loadInspection(ctx.orgId, input.inspection_id);
    await updateBusinessObject({ id: obj.id, status: 'held', metadata: { ...meta(obj), decision: decisionStamp(ctx, 'hold', input.reason) } }, ctx.orgId);
    return { inspection_id: obj.id, status: 'held' };
  },
};

const releaseInput = z.object({
  inspection_id: z.coerce.number().int().positive(),
  reason: z.string().min(1),
});

export const qcReleaseAction: Action<typeof releaseInput> = {
  id: 'qc.release',
  name: 'Release kit',
  description: 'Release a kit to ship — confirms a pass, or overrides a hold when a person judges the flag wrong (e.g. a new part revision). Input: { inspection_id, reason }.',
  inputSchema: releaseInput,
  grant: 'qc_decide',
  external: true,
  dedupKeyFor: input => `qc:${input.inspection_id}:qc.release`,
  reviewCard: (ctx, input) => card(ctx.orgId, input.inspection_id, { title: 'Release this kit?', headline: 'Release — ship it', detail: input.reason, approve: 'Release' }),
  async execute(ctx, input) {
    const obj = await loadInspection(ctx.orgId, input.inspection_id);
    const wasHeld = obj.status === 'held';
    await updateBusinessObject({ id: obj.id, status: 'released', metadata: { ...meta(obj), decision: { ...decisionStamp(ctx, 'release', input.reason), override: wasHeld } } }, ctx.orgId);
    return { inspection_id: obj.id, status: 'released', override: wasHeld };
  },
};

const reworkInput = z.object({
  inspection_id: z.coerce.number().int().positive(),
  note: z.string().min(1).describe('What to fix, in the assembler\'s terms'),
  assignee: z.string().optional().describe('Station or person, e.g. "Station 3"'),
});

export const qcRequestReworkAction: Action<typeof reworkInput> = {
  id: 'qc.request_rework',
  name: 'Request rework',
  description: 'Send a held kit back to the station with a plain-language note of what to fix. The note is recorded on the inspection (no message is sent in this deployment). Input: { inspection_id, note, assignee? }.',
  inputSchema: reworkInput,
  grant: 'qc_decide',
  external: true,
  dedupKeyFor: input => `qc:${input.inspection_id}:qc.request_rework`,
  reviewCard: (ctx, input) => card(ctx.orgId, input.inspection_id, {
    title: 'Send this kit to rework?',
    headline: `Rework${input.assignee ? ` → ${input.assignee}` : ''}`,
    detail: input.note,
    approve: 'Send to rework',
    extra: [{ label: 'Rework note', value: input.note }],
  }),
  async execute(ctx, input) {
    const obj = await loadInspection(ctx.orgId, input.inspection_id);
    await updateBusinessObject({
      id: obj.id,
      status: 'rework',
      metadata: { ...meta(obj), decision: decisionStamp(ctx, 'rework', input.note), rework: { note: input.note, assignee: input.assignee ?? null, sent: false, stubbed: true } },
    }, ctx.orgId);
    return { inspection_id: obj.id, status: 'rework', delivered: false, note: 'Recorded on the inspection; message delivery is stubbed in this deployment.' };
  },
};

const addExampleInput = z.object({
  inspection_id: z.coerce.number().int().positive(),
  label: z.enum(['good', 'bad']),
  reason: z.string().min(1),
});

export const datasetAddExampleAction: Action<typeof addExampleInput> = {
  id: 'dataset.add_example',
  name: 'Add training example',
  description: 'Copy an inspected photo into the template\'s good/ or bad/ training folder in S3 so the next model training run learns from this decision. Input: { inspection_id, label: good|bad, reason }.',
  inputSchema: addExampleInput,
  grant: 'qc_train',
  external: true,
  dedupKeyFor: input => `qc:${input.inspection_id}:dataset.add_example`,
  reviewCard: (ctx, input) => card(ctx.orgId, input.inspection_id, {
    title: `Add to the ${input.label.toUpperCase()} training set?`,
    headline: `Teach the standard — file as ${input.label}`,
    detail: input.reason,
    approve: `Add as ${input.label}`,
    extra: [{ label: 'Label', value: input.label }],
  }),
  async execute(ctx, input) {
    const obj = await loadInspection(ctx.orgId, input.inspection_id);
    const m = meta(obj);
    const bucket = typeof m.bucket === 'string' ? m.bucket : null;
    const key = typeof m.image_key === 'string' ? m.image_key : null;
    const template = typeof m.template_id === 'string' ? m.template_id : null;
    if (!bucket || !key || !template) {
      throw new Error('Inspection has no bucket / image_key / template_id — cannot file it as a training example');
    }
    const marker = 'templates/';
    const at = key.lastIndexOf(marker);
    const root = at >= 0 ? key.slice(0, at + marker.length) : marker;
    const toKey = `${root}${template}/${input.label}/${path.basename(key)}`;
    const alreadyThere = toKey === key || await objectExists({ bucket, key: toKey });
    if (!alreadyThere) {
      await copyObject({ bucket, fromKey: key, toKey, metadata: { template_id: template, label: input.label, decided_by: String(ctx.reviewedBy ?? ctx.invokedBy ?? ''), reason: input.reason.slice(0, 200) } });
    }
    await updateBusinessObject({
      id: obj.id,
      metadata: { ...m, training_example: { label: input.label, key: toKey, copied: !alreadyThere, reason: input.reason, at: new Date().toISOString() } },
    }, ctx.orgId);
    return { inspection_id: obj.id, label: input.label, s3_key: toKey, copied: !alreadyThere };
  },
};

export const qcActions = [qcHoldAction, qcReleaseAction, qcRequestReworkAction, datasetAddExampleAction];
