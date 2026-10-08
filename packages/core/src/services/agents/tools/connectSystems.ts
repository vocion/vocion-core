/**
 * `connect_system` — the one chat tool that walks a person through connecting
 * their systems ("connect my tools", "what should I connect?", "connect the
 * systems GTM uses").
 *
 * Generic over the registries: it takes connector slugs the person named (the
 * model read them from their words; nothing here matches words) and/or an app
 * id, builds the ranked plan (`services/connect/recommendations.ts`) and puts
 * one `connect-systems` card in the conversation. The card opens the docked
 * walk-through above the composer — one system at a time as a decision card
 * (Connect, Later, Skip, Stop), each verified before the next — and ends with
 * a summary of what each connected system unlocks. The walk-through needs no
 * further turn from the agent: it runs on its own RPCs.
 *
 * One connector, asked for by name with nothing else to plan, is still
 * `offer_connection`'s card; this is the walk through several.
 */

import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CONNECT_SYSTEMS_CARD_KIND, newCardId, readCard } from '@/libs/cards/card';
import { connectSystemsHref } from '@/libs/connect/systemsLink';

export const CONNECT_SYSTEM_TOOL = 'connect_system';

const InputSchema = z.object({
  named: z.array(z.string().min(1).max(80)).max(20).optional().describe('Connector slugs (from list_capabilities) of systems the person named, in their order. Leave out when they named none ("what should I connect?").'),
  app: z.string().min(1).max(80).optional().describe('An app id, to walk only the systems that app reads ("connect the systems GTM uses").'),
});
type Input = z.infer<typeof InputSchema>;

/**
 * Build the plan and put its card in the conversation.
 * @param ctx - The turn.
 * @param input - What the person named, or the app the plan is for.
 * @returns What the model reads.
 */
export async function connectSystem(ctx: RuntimeContext, input: Input): Promise<string> {
  const { recommendConnections } = await import('@/services/connect/recommendations');
  const plan = await recommendConnections({ orgId: ctx.orgId, userId: ctx.userId }, input);
  if (plan.refused) {
    return `${plan.refused}. Say so in one line and point them to a workspace admin.`;
  }
  const unknown = (input.named ?? []).filter(slug => !plan.candidates.some(c => c.connector === slug) && !plan.connected.some(c => c.connector === slug));
  if (plan.candidates.length === 0) {
    const done = plan.connected.map(c => c.name).join(', ');
    return `Nothing left to connect${done ? `: ${done} already connected` : ''}.${unknown.length > 0 ? ` Not a system this workspace can connect: ${unknown.join(', ')}.` : ''} Say so in one line; show no card.`;
  }
  const title = plan.scope ? `Connect the systems ${plan.scope.appName} uses` : 'Connect your systems';
  const card: Card = {
    id: newCardId(),
    kind: CONNECT_SYSTEMS_CARD_KIND,
    title,
    actions: [],
    source: { agentSlug: ctx.agentSlug, tool: CONNECT_SYSTEM_TOOL },
    href: connectSystemsHref(input),
    hrefLabel: 'Start',
    state: 'proposed',
  };
  const checked = readCard(card);
  if (!checked.ok) {
    return `Could not show the card: ${checked.reason}.`;
  }
  ctx.emit({ type: 'card', card: checked.card });
  const names = plan.candidates.map(c => c.name);
  const lines = [
    `Showed "${title}". It walks the person through ${plan.question ? `a question ("${plan.question.question}"), then ` : ''}${names.length} system${names.length === 1 ? '' : 's'} one at a time (${names.join(', ')}), verifies each and ends with a summary — above the composer, with no further turn from you.`,
  ];
  if (plan.connected.length > 0) {
    lines.push(`Already connected: ${plan.connected.map(c => c.name).join(', ')}.`);
  }
  if (unknown.length > 0) {
    lines.push(`Not a system this workspace can connect: ${unknown.join(', ')}. Say so in one line; do not invent a way.`);
  }
  lines.push('Write one short line before the card at most; never claim anything is connected until they say so or list_capabilities shows it.');
  return lines.join(' ');
}

/**
 * The tool, for every agent in a workspace: connecting is everyone's way in.
 * @param ctx - The turn.
 */
export function connectSystemTool(ctx: RuntimeContext) {
  return tool(async (input: Input) => connectSystem(ctx, input), {
    name: CONNECT_SYSTEM_TOOL,
    description: 'Walk the person through connecting their systems, one at a time, in a docked card above the composer: a ranked list from evidence (apps added here, their mail host, what their Org already uses, what they named), each connected by login or key, verified, then a summary of what each unlocks. Use for "connect my tools", "what should I connect?", "connect the systems <app> uses", or two or more systems named at once. Pass the connector slugs they named, or an app id.',
    schema: InputSchema,
  });
}
