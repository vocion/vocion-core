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

/** The kind field both connect tools take (`libs/connect/connectorKinds.ts`). */
export const CONNECTOR_KIND_FIELD = z.enum(['team', 'personal']).optional().describe('Which kind of connector the person means, read from their words. "team" (the default in a shared workspace): a shared system the workspace\'s agents use, connected by an admin in Team connectors. "personal": their OWN account for their personal assistant only — their inbox, their calendar, their files, their DMs, their GitHub — connected in Personal connectors. A request for the kind this workspace does not hold is answered with one line pointing to the right page, never a card.');

const InputSchema = z.object({
  kind: CONNECTOR_KIND_FIELD,
  named: z.array(z.string().min(1).max(80)).max(20).optional().describe('Connector slugs (from list_capabilities) of systems the person named in their own words, in their order — each one is shown to them as "You named it", so never a system you inferred. Leave out when they named none ("what should I connect?").'),
  title: z.string().min(3).max(90).optional().describe('The card\'s question, in your words for this person now ("Connect GitHub so the factory can read your repos?"). Compose it from the facts below; leave out only to use a plain default.'),
  why: z.string().min(3).max(240).optional().describe('One or two lines on why these systems matter to this person now, from the live facts (what is installed, what failed, what the team tried). Leave out to show none.'),
  app: z.string().min(1).max(80).optional().describe('An app id, to walk only the systems that app reads ("connect the systems GTM uses", "set up my software factory"). Setting up an app always passes its id.'),
  steps: z.array(z.object({
    connector: z.string().min(1).max(80).describe('The connector slug of one system in the walk.'),
    why: z.string().min(3).max(240).describe('One line for that system\'s step, in your words for this person now: why it matters to them, from its facts (describe_setup lists each system\'s facts: what needs it, what agents tried and failed, what it unlocks).'),
  })).max(20).optional().describe('Your line for each system\'s step, so every step of the walk leads with your words, not only the first. A system you leave out shows its evidence instead.'),
});
type Input = z.infer<typeof InputSchema>;

/**
 * Build the plan and put its card in the conversation.
 * @param ctx - The turn.
 * @param input - What the person named, or the app the plan is for.
 * @returns What the model reads.
 */
export async function connectSystem(ctx: RuntimeContext, input: Input): Promise<string> {
  // Team connectors are connected here; a request for the other kind, or any
  // request in a Personal workspace, gets one line pointing to the right page.
  if (ctx.workspaceKind === 'personal' || input.kind === 'personal') {
    const { connectKindCheck } = await import('@/services/connect/connectorKindRouting');
    const decision = await connectKindCheck(ctx, input.named ?? [], input.kind ?? (input.app ? 'team' : undefined));
    if (!decision.proceed) {
      return decision.reply;
    }
  }
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
  // The words are the agent's, composed from the live facts at this turn; the
  // template is only the fallback (founder, 2026-10-09: "not hard coded
  // bullshit that gets stale").
  const title = input.title?.trim() || (plan.scope ? `Connect the team connectors ${plan.scope.appName} uses` : 'Connect your team connectors');
  // Every step's line, for the systems actually walked.
  const walked = new Set(plan.candidates.map(c => c.connector));
  const say = Object.fromEntries((input.steps ?? []).filter(s => walked.has(s.connector) && s.why.trim()).map(s => [s.connector, s.why.trim()]));
  const card: Card = {
    id: newCardId(),
    kind: CONNECT_SYSTEMS_CARD_KIND,
    title,
    ...(input.why?.trim() ? { body: input.why.trim() } : {}),
    actions: [],
    source: { agentSlug: ctx.agentSlug, tool: CONNECT_SYSTEM_TOOL },
    href: connectSystemsHref({ named: input.named, app: input.app, say }),
    hrefLabel: 'Start',
    state: 'proposed',
  };
  const checked = readCard(card);
  if (!checked.ok) {
    return `Could not show the card: ${checked.reason}.`;
  }
  ctx.emit({ type: 'card', card: checked.card });
  const names = plan.candidates.map(c => c.name);
  const { evidenceLine, unlockLine } = await import('@/libs/connect/systemsPlan');
  const lines = [
    `Showed "${title}". It walks the person through ${plan.question ? `a question ("${plan.question.question}"), then ` : ''}${names.length} system${names.length === 1 ? '' : 's'} one at a time (${names.join(', ')}), verifies each and ends with a summary, with no further turn from you.`,
    // Facts, not copy: what each system is offered on, and what it unlocks —
    // for the one line you say before the card, in your own words.
    ...plan.candidates.map(c => `- ${c.name}: ${c.evidence.map(evidenceLine).join('; ') || 'no evidence beyond the request'}; unlocks ${unlockLine(c, 'connected')}.`),
  ];
  const voiced = plan.candidates.filter(c => say[c.connector]).map(c => c.name);
  const unvoiced = plan.candidates.filter(c => !say[c.connector]).map(c => c.name);
  if (voiced.length > 0) {
    lines.push(`Your lines lead the steps for ${voiced.join(', ')}.${unvoiced.length > 0 ? ` ${unvoiced.join(', ')} show${unvoiced.length === 1 ? 's' : ''} its evidence.` : ''}`);
  }
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
    description: 'Walk the person through connecting the workspace\'s team connectors — the shared systems its agents use — one at a time, in a docked card above the composer: a ranked list from evidence (apps added here, their mail host, what their Org already uses, what they named), each connected by login or key, verified, then a summary of what each unlocks. Use for "connect my tools", "what should I connect?", "connect the systems <app> uses", or two or more systems named at once. Pass the connector slugs they named, or an app id.',
    schema: InputSchema,
  });
}
