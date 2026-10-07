/**
 * `describe_setup` — what the workspace's plugins still need before they can
 * work, as the platform judges it (`services/plugins/setupState.ts`), with the
 * link for each step. The same answer the "Set up your <plugin>" chip is built
 * from, so the agent guiding a person through setup and the chip that sent
 * them never disagree. Read-only.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { connectOptionFor } from '@/libs/connect/registry';
import { setupStateForOrg } from '@/services/plugins/setupState';

export const DESCRIBE_SETUP_TOOL = 'describe_setup';

/**
 * Where a person does a step. A connector with a vendor login and a declared
 * source gets the login's start URL (admins only, which the server enforces);
 * otherwise the Connectors page, where a key can be pasted.
 * @param step - The step.
 * @param step.slug - Connector slug.
 * @param step.sources - Source slugs of that connector in this workspace.
 */
export function connectorStepHref(step: { slug: string; sources?: string[] }): { href: string; how: string } {
  const option = connectOptionFor(step.slug);
  const source = step.sources?.[0];
  if (option && option.configured && source) {
    return {
      href: `/api/connect/${option.provider}/start?source=${encodeURIComponent(source)}`,
      how: `log in with ${option.label} (a workspace admin; the login is the approval)`,
    };
  }
  if (option && !option.configured) {
    return { href: '/dashboard/connectors', how: `paste a credential on the Connectors page (the ${option.label} login is not configured on this deployment)` };
  }
  if (!source) {
    return { href: '/dashboard/connectors', how: 'the workspace declares no source of this kind yet; one is added in the workspace files, then connected on the Connectors page' };
  }
  return { href: '/dashboard/connectors', how: 'paste a credential on the Connectors page' };
}

export function describeSetupTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const setups = await setupStateForOrg(ctx.orgId);
      if (setups.length === 0) {
        return 'No plugin in this workspace declares setup steps, so there is nothing to set up from here.';
      }
      const blocks = setups.map((p) => {
        const lines = [`${p.name} (${p.plugin}) — ${p.complete ? 'set up' : `${p.steps.filter(s => !s.done).length} of ${p.steps.length} step${p.steps.length === 1 ? '' : 's'} remaining`}`];
        for (const step of p.steps) {
          if (step.kind === 'connector') {
            const { href, how } = connectorStepHref(step);
            lines.push(`  [${step.done ? 'done' : 'todo'}] ${step.label}${step.sources && step.sources.length > 0 ? ` (source${step.sources.length === 1 ? '' : 's'}: ${step.sources.join(', ')})` : ''}${step.done ? '' : ` — ${how}; link: ${href}`}`);
          } else {
            lines.push(`  [${step.done ? 'done' : 'todo'}] ${step.label}${step.done ? '' : ` — file it with the file_${step.slug} tool when the person has said what it is, or they create it on the record's page`}`);
          }
        }
        return lines.join('\n');
      });
      return blocks.join('\n\n');
    },
    {
      name: DESCRIBE_SETUP_TOOL,
      description: 'What this workspace\'s plugins still need before they can work: each setup step the plugin declares (a connector to connect, a first record to create), whether it is done, and the exact link a person uses for it. Call this first when a person asks to set something up, when a plugin seems to have nothing to read, or when a chip said "Set up your …". Read-only; it never connects anything itself.',
      schema: z.object({}),
    },
  );
}
