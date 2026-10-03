/**
 * eval.add_case — a correction a person made becomes a regression case.
 *
 * `learning.adopt_rule` turns a correction into a rule the agent reads next
 * time. That fixes the next piece of work; it does not stop the same mistake
 * coming back when the prompt, the model or the rules change later. The
 * other half is a test: the input that drew the correction, and what a good
 * answer does, appended to the agent's eval dataset so every later update is
 * run against it before it ships.
 *
 * Gated like every other self-improving kind: a person sees the case before
 * it joins the suite, because a wrong case fails every good update after it.
 * Undo takes the case back out.
 *
 * The dataset's items live in `eval_dataset.items`. A workspace that authors
 * the dataset in `evals/<slug>.yaml` has the file as its source of truth, and
 * the next `workspace:apply` writes the file's items back — so the result
 * says so, and the case belongs in the file too before the next apply.
 */

import type { Action } from './types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const addCaseInput = z.object({
  /** The eval dataset the case joins — the agent's regression suite. */
  datasetSlug: z.string().min(1).max(120),
  /** The message that drew the correction, as the agent received it. */
  input: z.string().min(1).max(4000),
  /** What a good answer does, in substance — not the exact words. */
  expectedOutput: z.string().min(1).max(2000),
  /** How the judge decides, when the expected output is not enough. */
  rubric: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(60)).max(10).optional(),
  /** Facts the answer must state, read by the judge. */
  assertions: z.array(z.string().min(1).max(400)).max(10).optional(),
  /** What the person actually wrote, kept as the evidence behind the case. */
  note: z.string().min(1).max(2000),
  /** Why this is worth a permanent case — read back on the card. */
  reason: z.string().min(1).max(500),
});

export type AddCaseInput = z.infer<typeof addCaseInput>;

export const evalAddCaseAction: Action<typeof addCaseInput> = {
  id: 'eval.add_case',
  name: 'Add a regression case from a correction',
  description: 'Append a case to an agent\'s eval dataset, drawn from a correction a person made, so every later update is tested against it before it ships. Reversible — Undo removes the case.',
  inputSchema: addCaseInput,
  grant: 'write_learning',
  external: false,
  selfImproving: true,
  dedupKeyFor: input => `eval.add_case:${input.datasetSlug}:${input.input.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}:${input.expectedOutput.slice(0, 60)}`,
  async reviewCard(_ctx, input) {
    return {
      title: `Add a regression case to ${input.datasetSlug}`,
      system: 'Evals',
      confidenceSubject: 'This belongs in the regression suite',
      summary: input.reason,
      fields: [
        { label: 'Case', value: input.input.slice(0, 400) },
        { label: 'A good answer', value: input.expectedOutput },
        ...(input.assertions?.length ? [{ label: 'Must state', value: input.assertions.join(' · ') }] : []),
        { label: 'They said', value: input.note.slice(0, 400) },
        { label: 'Suite', value: input.datasetSlug },
      ],
      nextAction: 'Approving adds the case to the suite; every later update to this agent runs it before it ships. Undo takes it out.',
      verbs: { approve: 'Add the case', reject: 'Not a test' },
    };
  },
  async execute(ctx, input) {
    const { db } = await import('@/libs/DB');
    const { evalDatasetSchema } = await import('@/models/Schema');
    const [dataset] = await db.select().from(evalDatasetSchema).where(and(eq(evalDatasetSchema.orgId, ctx.orgId), eq(evalDatasetSchema.slug, input.datasetSlug)));
    if (!dataset) {
      throw new Error(`No eval dataset "${input.datasetSlug}" in this workspace`);
    }
    // The same case twice is one case: a correction repeated is evidence the
    // case matters, not a reason to run it twice.
    const existing = dataset.items.findIndex(i => i.input === input.input && i.expectedOutput === input.expectedOutput);
    if (existing !== -1) {
      return { outcome: 'duplicate', datasetSlug: input.datasetSlug, caseIndex: existing, cases: dataset.items.length };
    }
    const item = {
      input: input.input,
      expectedOutput: input.expectedOutput,
      ...(input.rubric ? { rubric: input.rubric } : {}),
      ...(input.assertions?.length ? { assertions: input.assertions } : {}),
      tags: [...(input.tags ?? []), 'from-correction'],
    };
    const items = [...dataset.items, item];
    await db.update(evalDatasetSchema)
      .set({ items, version: dataset.version + 1, updatedAt: new Date() })
      .where(eq(evalDatasetSchema.id, dataset.id));
    return {
      outcome: 'added',
      datasetSlug: input.datasetSlug,
      caseIndex: items.length - 1,
      cases: items.length,
      version: dataset.version + 1,
      note: 'A later workspace:apply writes the dataset file back; commit this case to evals/ to keep it.',
    };
  },
  async undo(ctx, input, result) {
    if (result.outcome !== 'added') {
      return { undone: false, reason: 'nothing was added' };
    }
    const { db } = await import('@/libs/DB');
    const { evalDatasetSchema } = await import('@/models/Schema');
    const [dataset] = await db.select().from(evalDatasetSchema).where(and(eq(evalDatasetSchema.orgId, ctx.orgId), eq(evalDatasetSchema.slug, input.datasetSlug)));
    if (!dataset) {
      return { undone: false, reason: 'the dataset is gone' };
    }
    const items = dataset.items.filter(i => !(i.input === input.input && i.expectedOutput === input.expectedOutput));
    if (items.length === dataset.items.length) {
      return { undone: false, reason: 'the case is no longer in the suite' };
    }
    await db.update(evalDatasetSchema).set({ items, version: dataset.version + 1, updatedAt: new Date() }).where(eq(evalDatasetSchema.id, dataset.id));
    return { undone: true, cases: items.length };
  },
};
