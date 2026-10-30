import { z } from 'zod';

const short = z.string().trim().max(200);
const note = z.string().trim().max(2000);
export const rolloutStages = ['discovery', 'pilot', 'rollout', 'live', 'paused', 'retired'] as const;
export const improvementStates = ['planned', 'doing', 'measuring', 'closed'] as const;
export const portfolioData = z.object({
  name: short.min(1),
  objective: note,
  owner: short,
  teamSlug: z.string().max(120).nullable(),
  stage: z.enum(rolloutStages),
  successMeasure: note,
  baseline: note,
  expectedBenefit: note,
  improvements: z.array(z.object({
    id: z.string().uuid(),
    title: short.min(1),
    owner: short.min(1),
    hypothesis: note.min(1),
    baseline: note.min(1),
    successMeasure: note.min(1),
    followUp: z.iso.date(),
    status: z.enum(improvementStates),
    result: note,
    decision: z.enum(['unproven', 'keep', 'revise', 'revert']),
  }).strict().refine(i => i.status !== 'closed' || i.result.length > 0, 'Closing an improvement requires follow-up evidence')).max(100),
}).strict();
export type PortfolioData = z.infer<typeof portfolioData>;
export const portfolioCommand = z.object({
  eventKey: z.string().uuid(),
  id: z.string().uuid(),
  version: z.number().int().min(-1),
  data: portfolioData,
  itemIds: z.array(z.string().uuid()).max(1000),
}).strict();
export type PortfolioCommand = z.infer<typeof portfolioCommand>;
