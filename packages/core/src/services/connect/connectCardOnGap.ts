/**
 * A SYSTEM THAT IS NOT CONNECTED IS ANSWERED WITH ITS CONNECT CARD.
 *
 * On 2026-10-29 a person asked "are we connected to publish <client> on
 * GitHub?". The turn looked at what the workspace could add, saw GitHub was
 * not connected, and answered "No, GitHub is not connected… Want me to walk
 * you through it?" — words about the action instead of the action. The card
 * the SEO strategist files for the same gap ("Connect GitHub · Log in with
 * GitHub, recommended · Use an API key instead") was one call away.
 *
 * So the card no longer waits on the model offering it. When a turn's own
 * tools establish that a system is not connected — a tool asked about that
 * system (`list_capabilities` / `setup_options` with `connector`), or a tool
 * that could not run for want of it (`libs/connect/connectionNeeded.ts`) —
 * and the system has a one-click sign-in, the card is shown in that turn, the
 * same card `offer_connection` draws (`offerConnection`), once per system.
 * Only in a person's own conversation: an agent on its own schedule has
 * nobody to tap it.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '@/services/agents/types';
import { connectorNeededBy, saysConnectionMissing } from '@/libs/connect/connectionNeeded';
import { howToConnectFor } from '@/libs/platforms/registry';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';

/** The harness rule: the card is the answer to a missing connection, never an offer of steps. */
export const SHOW_THE_CONNECT_CARD = [
  'A system the person asked about, or the work needs, that is not connected is answered with its connect card, never with words about connecting.',
  'Never offer to "walk them through" connecting, and never list the steps: call offer_connection with that connector (or pass `connector` to list_capabilities), say in one line that it is not connected and what connecting it lets you do, and stop. The card has the sign-in, recommended first, and the API key behind it.',
  // 2026-10-29: "It said it did connect" was answered "GitHub is now
  // connected" with no GitHub source (`connectionTruth.ts`).
  'Whether a system is connected, and what you can now read, comes only from state read in this turn (list_capabilities with `connector`, or the CONNECTIONS lines on the turn), never from the person saying it connected or from an earlier turn. When they say it connected, check first; if it is not, say so plainly with the reason the state shows, and the card stays.',
].join(' ');

/** The systems a turn has already shown a card for. */
const shown = new WeakMap<object, Set<string>>();

/**
 * Whether a connector signs in with one click (a vendor login), rather than
 * only with a pasted key.
 * @param connectorSlug - e.g. "github".
 */
export function hasOneClickSignIn(connectorSlug: string): boolean {
  return Boolean(howToConnectFor(connectorSlug)?.login);
}

/**
 * Show the connect card for a system this turn found not connected, when the
 * turn is a person's own and the system signs in with one click. Once per
 * system per turn. Never throws: a card that could not be drawn leaves the
 * tool's own answer as it was.
 * @param ctx - The turn.
 * @param connectorSlug - The system that is not connected.
 * @param why - What connecting it lets this workspace do, when the caller knows.
 * @returns What the model reads about the card, or null when none was shown.
 */
export async function connectCardForGap(ctx: RuntimeContext, connectorSlug: string, why?: string): Promise<string | null> {
  // A person in their own conversation: a token caller (an outside MCP
  // client) or an agent on its own schedule has no card to tap.
  if (!ctx.conversationId || !ctx.userId || ctx.userId.startsWith('token:') || isAgentsOwnSchedule(ctx) || !hasOneClickSignIn(connectorSlug)) {
    return null;
  }
  const seen = shown.get(ctx) ?? new Set<string>();
  if (seen.has(connectorSlug)) {
    return null;
  }
  seen.add(connectorSlug);
  shown.set(ctx, seen);
  try {
    const { offerConnection } = await import('@/services/agents/tools/offerConnection');
    // Only a card that was actually drawn is announced: a team connector the
    // person cannot connect, or one already connected, draws none.
    let drawn = false;
    const emit = ctx.emit;
    const watching: RuntimeContext = { ...ctx, emit: (event) => {
      if (event.type === 'card' || event.type === 'decision') {
        drawn = true;
      }
      emit(event);
    } };
    const said = await offerConnection(watching, { connector: connectorSlug, why: why ?? 'It is not connected, and this work needs it.', named: true });
    return drawn ? `NOT CONNECTED — THE CARD IS UP: ${said} Say in one line that it is not connected and point at the card; never offer to walk them through it.` : null;
  } catch {
    return null;
  }
}

/**
 * A tool's result as text, when it carries text.
 * @param result - What the tool returned: a string, or a tool message.
 */
function resultText(result: unknown): string | null {
  if (typeof result === 'string') {
    return result;
  }
  const content = (result as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * The same result with a line added for the model.
 * @param result - What the tool returned.
 * @param line - The line.
 */
function withLine(result: unknown, line: string): unknown {
  if (typeof result === 'string') {
    return withLineOn(result, line);
  }
  const message = result as { content?: unknown };
  if (message && typeof message.content === 'string') {
    message.content = withLineOn(message.content, line);
  }
  return result;
}

/**
 * The line on a text result. A JSON object stays JSON, with the line as its
 * `connectCard` field, so a caller that parses the result still can.
 * @param text - The result.
 * @param line - The line.
 */
function withLineOn(text: string, line: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...parsed, connectCard: line }, null, 2);
    }
  } catch {
    // Not JSON: the line goes underneath.
  }
  return `${text}\n\n${line}`;
}

/**
 * Which connector a tool's result says it needed and did not have, among the
 * systems a person can connect. Pure apart from the connector list.
 * @param toolName - The tool.
 * @param text - What it returned.
 */
export async function connectorMissingFrom(toolName: string, text: string): Promise<string | null> {
  if (!saysConnectionMissing(text)) {
    return null;
  }
  const { connectableConnectors } = await import('./recommendations');
  return connectorNeededBy(toolName, text, connectableConnectors());
}

/**
 * Wrap a tool so a result that says it could not run for want of a
 * connection shows that system's connect card in the same turn.
 * @param toolObj - The tool.
 * @param ctx - The turn.
 */
export function withConnectCardOnGap(toolObj: StructuredToolInterface, ctx: RuntimeContext): StructuredToolInterface {
  const originalInvoke = toolObj.invoke.bind(toolObj);
  const wrapped = async (input: unknown, config?: unknown): Promise<unknown> => {
    const result = await originalInvoke(input as never, config as never);
    try {
      const text = resultText(result);
      const connector = text ? await connectorMissingFrom(toolObj.name, text) : null;
      const line = connector ? await connectCardForGap(ctx, connector) : null;
      return line ? withLine(result, line) : result;
    } catch {
      return result;
    }
  };
  (toolObj as { invoke: typeof wrapped }).invoke = wrapped;
  return toolObj;
}
