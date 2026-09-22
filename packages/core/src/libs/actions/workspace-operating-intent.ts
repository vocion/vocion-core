/**
 * workspace.write_operating_intent, the one write path for the Guide page.
 *
 * Operating intent is a person saying what they want the factory doing:
 * outcomes, what beats what, what may not happen without asking, what may be
 * spent, which classes of action run unattended, and the product judgment no
 * agent can derive from records. It is authored as `operating-intent.yaml`
 * in the workspace, which is what makes it diffable and versioned.
 *
 * The Guide page does NOT write that file directly. An edit is proposed on
 * the action rail, so a change of direction lands as an `action_run` a person
 * can point at afterwards, with the reason attached and the previous text one
 * Undo away, rather than as a silent mutation of a config column. That is the
 * whole argument for routing a settings form through the rail: a priority
 * that changed and nobody can say when or why is not a priority.
 *
 * Risk tier `medium` (`services/autonomy/rungs.ts`), for the same reason
 * missions and playbooks are: internal and reversible, so the done-for-you
 * default would run it above 0.8, but this file is the standing instruction
 * every choosing agent reads. A workspace promotes it in `trust.yaml` once
 * approvals have earned it.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { diffCounts, unifiedLineDiff } from '@/libs/workspace/lineDiff';

const writeOperatingIntentInput = z.object({
  /** The whole file as it should read afterwards, never a fragment. */
  content: z.string().min(1).max(200_000),
  /** Why this change of intent, in a sentence a person can check later. */
  reason: z.string().min(1).max(500),
});

export type WriteOperatingIntentInput = z.infer<typeof writeOperatingIntentInput>;

/**
 * A one line count of what the intent now states, for the card.
 * @param content - The proposed file.
 */
export async function describeOperatingIntent(content: string): Promise<string> {
  const { parseOperatingIntent } = await import('@/services/workspace/OperatingIntentService');
  const { intent } = parseOperatingIntent(content);
  if (!intent) {
    return 'unreadable';
  }
  const parts = [
    `${intent.outcomes.length} outcome(s)`,
    `${intent.priorities.length} priority rule(s)`,
    `${intent.constraints.length} constraint(s)`,
    intent.budget ? `budget $${(intent.budget.limitCents / 100).toFixed(2)} per ${intent.budget.window} (advisory)` : 'no budget stated',
    `${intent.autonomy.length} autonomy rule(s)`,
    `${intent.productJudgment.length} judgment note(s)`,
  ];
  return parts.join(', ');
}

async function precheck(ctx: ActionContext, input: WriteOperatingIntentInput): Promise<string | void> {
  const { parseOperatingIntent, readOperatingIntent } = await import('@/services/workspace/OperatingIntentService');
  const { error } = parseOperatingIntent(input.content);
  if (error) {
    return `the operating intent does not validate: ${error}`;
  }
  const current = await readOperatingIntent(ctx.orgId);
  if (current.blocker) {
    return `the operating intent cannot be written from here: ${current.blocker}`;
  }
  return undefined;
}

export const workspaceWriteOperatingIntentAction: Action<typeof writeOperatingIntentInput> = {
  id: 'workspace.write_operating_intent',
  name: 'Write the operating intent',
  description: 'Create or revise the workspace\'s operating intent (outcomes, priorities, constraints, budget, autonomy policy, product judgment) and apply it, so the agents that choose work read the new statement. Reversible: the previous text is one Undo away.',
  inputSchema: writeOperatingIntentInput,
  grant: 'manage_workspace',
  external: false,
  // One file, so one pending card: a second proposal about the intent
  // replaces the first rather than queueing a second opinion beside it.
  dedupKeyFor: () => 'workspace.write_operating_intent',
  precheck,
  async reviewCard(ctx, input) {
    const { readOperatingIntent } = await import('@/services/workspace/OperatingIntentService');
    const current = await readOperatingIntent(ctx.orgId);
    const before = current.text ?? '';
    const counts = diffCounts(before, input.content);
    const diff = unifiedLineDiff(before, input.content, { context: 2, maxChars: 3000 });
    return {
      title: current.text ? 'Revise the operating intent' : 'State the operating intent',
      system: 'Workspace',
      summary: input.reason,
      fields: [
        { label: 'What it will say', value: await describeOperatingIntent(input.content), href: '/dashboard/guide' },
        { label: 'File', value: 'operating-intent.yaml' },
        { label: 'Change', value: current.text ? `-${counts.removed} / +${counts.added} lines` : `${input.content.length.toLocaleString()} characters, new file` },
        { label: 'Diff', value: diff || (current.text ? 'No change to the text.' : input.content.slice(0, 1500)) },
      ],
      nextAction: current.text
        ? 'Approving writes the file and applies the workspace, so the agents that choose work read the new statement on their next turn. The previous text stays one Undo away.'
        : 'Approving creates operating-intent.yaml and applies the workspace. Undo removes it.',
      verbs: { approve: current.text ? 'Revise' : 'State it', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { writeOperatingIntent } = await import('@/services/workspace/OperatingIntentService');
    const res = await writeOperatingIntent({
      orgId: ctx.orgId,
      content: input.content,
      appliedBy: ctx.reviewedBy ?? ctx.invokedBy ?? 'workspace.write_operating_intent',
    });
    return {
      path: res.path,
      previous: res.previous,
      created: res.created,
      unchanged: res.unchanged,
      sha: res.applied?.sha ?? null,
      applyErrors: res.applied?.errors ?? null,
      states: await describeOperatingIntent(input.content),
      href: '/dashboard/guide',
    };
  },
  async undo(ctx, _input, result) {
    const { restoreOperatingIntent } = await import('@/services/workspace/OperatingIntentService');
    if (result.unchanged === true) {
      return { undone: false, reason: 'nothing was written' };
    }
    const previous = typeof result.previous === 'string' ? result.previous : null;
    if (previous === null && result.created !== true) {
      return { undone: false, reason: 'no previous text on the run' };
    }
    const res = await restoreOperatingIntent({
      orgId: ctx.orgId,
      previous,
      appliedBy: `${ctx.reviewedBy ?? ctx.invokedBy ?? 'workspace.write_operating_intent'}:undo`,
    });
    return { undone: true, removed: previous === null, sha: res.applied.sha };
  },
};
