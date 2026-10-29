import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const key = z.string().min(1).max(120).regex(/^[\w:.-]+$/);
const identity = { eventKey: key };
const revision = { ...identity, itemId: z.string().uuid(), version: z.number().int().nonnegative() };
export const workforceCommand = z.discriminatedUnion('kind', [
  z.object({
    ...identity,
    kind: z.literal('create'),
    key,
    workflow: z.enum(['human-assisted', 'scheduled', 'multi-agent']),
    title: text.max(200),
    agentSlug: key,
    rubric: text,
    configurationVersion: key,
    baselineMinutes: z.number().int().min(1).max(10080).optional(),
    baselineEvidence: text.optional(),
    test: z.boolean().default(false),
  }).strict(),
  z.object({ ...revision, kind: z.literal('link'), sourceKind: z.enum(['action', 'worker']), sourceId: z.number().int().positive() }).strict(),
  z.object({
    ...revision,
    kind: z.literal('review'),
    status: z.enum(['accepted', 'corrected', 'rejected', 'blocked', 'reopened']),
    reason: z.enum(['meets-rubric', 'context', 'data-access', 'playbook', 'approval', 'execution', 'routing', 'other']),
    evidence: text,
    // Human-reported ACTIVE effort, never time spent sitting in the queue.
    effortMinutes: z.number().int().min(0).max(1440).optional(),
  }).strict(),
]);
export type WorkforceCommand = z.infer<typeof workforceCommand>;

export class WorkforceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'WorkforceError';
  }
}
