import type { Action, ActionContext } from './types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

const workspaceDescribeInput = z.object({
  description: z.string().trim().min(10).max(600),
});

/**
 * Write a workspace's description. The applier never writes
 * `project.description`, so a saved description survives every apply.
 * @param ctx - Action context (the workspace).
 * @param description - The new value, or null to clear it.
 */
async function writeDescription(ctx: ActionContext, description: string | null): Promise<void> {
  await db.update(projectSchema).set({ description }).where(eq(projectSchema.id, ctx.orgId));
}

/**
 * Save what a workspace is for (#1028). The setup conversation asks first,
 * and the answer is what makes every later recommendation fit: which
 * plugins, which connectors, which first records.
 */
export const workspaceDescribeAction: Action<typeof workspaceDescribeInput> = {
  id: 'workspace.describe',
  name: 'Describe this workspace',
  description: 'Save what this workspace is for (the client or team, and the outcome it serves) as its description. Reversible.',
  inputSchema: workspaceDescribeInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `workspace.describe:${input.description}`,
  async reviewCard(_ctx, input) {
    return {
      title: 'Save the workspace description',
      system: 'Workspace',
      summary: input.description,
      fields: [{ label: 'Description', value: input.description }],
      nextAction: 'Approving saves this as the workspace description. Undo puts the previous one back.',
      verbs: { approve: 'Save', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const [before] = await db.select({ description: projectSchema.description }).from(projectSchema).where(eq(projectSchema.id, ctx.orgId)).limit(1);
    await writeDescription(ctx, input.description);
    return { before: before?.description ?? null, after: input.description };
  },
  async undo(ctx, _input, result) {
    const before = typeof result.before === 'string' ? result.before : null;
    await writeDescription(ctx, before);
    return { restored: before };
  },
};
