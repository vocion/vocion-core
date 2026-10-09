/**
 * `describe_setup` — what the workspace's plugins still need before they can
 * work, as the platform judges it (`services/plugins/setupState.ts`), with the
 * link for each step (the same connect flow `offer_connection` opens). The same answer the "Set up your <plugin>" chip is built
 * from, so the agent guiding a person through setup and the chip that sent
 * them never disagree. Read-only.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { startSetupObjective } from '@/services/objectives/ObjectiveService';
import { setupStateForOrg } from '@/services/plugins/setupState';
import { connectHref } from './offerConnection';

export const DESCRIBE_SETUP_TOOL = 'describe_setup';

/**
 * Where a person does a connector step: the Connectors page's add flow for
 * that connector, carrying the way back to this conversation — the one
 * connect path (#1080), the same one `offer_connection`'s card opens. The
 * page runs the vendor login where the deployment has one and takes a pasted
 * key otherwise, so this never has to know which.
 * @param step - The step.
 * @param step.slug - Connector slug.
 * @param step.sources - Source slugs of that connector in this workspace.
 * @param conversationId - The current conversation, when the turn has one.
 */
export function connectorStepHref(step: { slug: string; sources?: string[] }, conversationId?: number | null): { href: string; how: string } {
  const href = connectHref(step.slug, conversationId ?? undefined);
  if (!step.sources || step.sources.length === 0) {
    return { href, how: 'the workspace declares no source of this kind yet; connecting it on the Connectors page creates one (a workspace admin)' };
  }
  return { href, how: 'connect it on the Connectors page (a workspace admin; the login or the pasted key is the approval), or offer it as a card with offer_connection' };
}

/**
 * Whether this turn is a person's own, in a conversation they are looking at
 * — the only place an objective's line is drawn. Not a mission, a schedule
 * or an MCP caller.
 * @param ctx - The turn.
 */
function personsConversation(ctx: RuntimeContext): ctx is RuntimeContext & { conversationId: number; userId: string } {
  return typeof ctx.conversationId === 'number' && !!ctx.userId && ctx.userId !== 'mcp' && ctx.userId !== 'scheduled' && ctx.missionRunId === undefined;
}

export function describeSetupTool(ctx: RuntimeContext) {
  return tool(
    async (input: { plugin?: string }) => {
      const setups = await setupStateForOrg(ctx.orgId);
      if (setups.length === 0) {
        return 'No plugin in this workspace declares setup steps, so there is nothing to set up from here.';
      }
      // Reading the setup in a person's own conversation starts its
      // objective there: one quiet line above the dock, "Setting up
      // <plugin> · 2 of 3 · Stop", read live from these same steps
      // (`libs/objectives/objective.ts`). Never fails the read.
      let tracking: string | null = null;
      if (personsConversation(ctx)) {
        tracking = await startSetupObjective({ orgId: ctx.orgId, conversationId: ctx.conversationId, plugin: input?.plugin ?? null }).catch(() => null);
      }
      const blocks = setups.map((p) => {
        const lines = [`${p.name} (${p.plugin}) — ${p.complete ? 'set up' : `${p.steps.filter(s => !s.done).length} of ${p.steps.length} step${p.steps.length === 1 ? '' : 's'} remaining`}`];
        for (const step of p.steps) {
          if (step.kind === 'connector') {
            const { href, how } = connectorStepHref(step, ctx.conversationId);
            lines.push(`  [${step.done ? 'done' : 'todo'}] ${step.label}${step.sources && step.sources.length > 0 ? ` (source${step.sources.length === 1 ? '' : 's'}: ${step.sources.join(', ')})` : ''}${step.done ? '' : ` — ${how}; link: ${href}`}`);
          } else {
            lines.push(`  [${step.done ? 'done' : 'todo'}] ${step.label}${step.done ? '' : ` — file it with the file_${step.slug} tool when the person has said what it is, or they create it on the record's page`}`);
          }
        }
        return lines.join('\n');
      });
      const tail = tracking ? `\n\nThe person sees "Setting up ${setups.find(s => s.plugin === tracking)?.name ?? tracking}" with its progress above the composer, read from these steps; do not restate the progress in prose.` : '';
      return blocks.join('\n\n') + tail;
    },
    {
      name: DESCRIBE_SETUP_TOOL,
      description: 'What this workspace\'s plugins still need before they can work: each setup step the plugin declares (a connector to connect, a first record to create), whether it is done, and the link a person uses for it (a connector step\'s link is the Connectors page\'s add flow, the same one offer_connection\'s card opens; prefer the card in chat). Call this first when a person asks to set something up, when a plugin seems to have nothing to read, or when a chip said "Set up your …". Read-only; it never connects anything itself.',
      schema: z.object({
        plugin: z.string().min(1).max(80).optional().describe('The plugin slug the person is setting up, when they named one ("set up my software factory" → its slug from the list). Leave out when they did not say.'),
      }),
    },
  );
}
