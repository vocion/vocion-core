'use client';

/**
 * The one line a decision surface mounts to say what the decision taught.
 *
 * Deliberately a SECOND toast rather than an edit to the existing one: the
 * existing toast says what happened, this one says what was learned, and a
 * mount that is a single statement is a mount that rebases cleanly when two
 * sessions are in the same file.
 */

import type { DecisionLearningInput } from './learnedFromDecision';
import { toast } from '@/components/ui/toast';
import { client } from '@/libs/Orpc';
import { learnedFromDecision } from './learnedFromDecision';

/**
 * Say it, with Undo where there is something to undo. Fire-and-forget: a
 * decision is never blocked by what it taught.
 * @param input - What was decided.
 */
export function showLearnedToast(input: DecisionLearningInput): void {
  const learned = learnedFromDecision(input);
  const runId = learned.undoRunId;
  toast.info(learned.title, {
    description: learned.description,
    ...(runId === undefined
      ? {}
      : {
          action: {
            label: 'Undo',
            onClick: () => {
              void client.review
                .undoAction({ id: runId })
                .then(() => toast.success('Undone', { description: 'Put back, and the kind is held at approval again.' }))
                .catch((err: unknown) => toast.error('Could not undo that', { description: err instanceof Error ? err.message : String(err) }));
            },
          },
        }),
  });
}
