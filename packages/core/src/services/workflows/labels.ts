/**
 * How a list names a workflow run (Activity, the work line, the review
 * queue): the run's own label (`input.runLabel`, from the workflow's
 * `runLabel:`), and the label of the step it is on now.
 */
import { sql } from 'drizzle-orm';
import { workflowRunSchema } from '@/models/Schema';

/** The run's label, or null. */
export const runLabelSql = sql<string | null>`${workflowRunSchema.input} ->> 'runLabel'`;

/**
 * The label of the step the run is on — running, or waiting on a person — or
 * null. Inside a repeat group the group and its step both run; the step's own
 * label ("Editor review · round 2 of 3") is the one named.
 */
export const currentStepLabelSql = sql<string | null>`(
  select s.value ->> 'label'
  from jsonb_each(coalesce(${workflowRunSchema.stepResults}, '{}'::jsonb)) as s
  where s.value ->> 'status' in ('running', 'awaiting_approval')
  order by (s.value ? 'repeat') asc
  limit 1
)`;
