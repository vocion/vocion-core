/**
 * The connect stub — a tool that is PRESENT but not connected.
 *
 * The one structural change this whole feature hangs off. A connector with no
 * credential used to be ABSENT from the model's tool list, and absent means the
 * model can only talk: it writes "connect your calendar and I can do that", and
 * nothing in the system knows a connection was asked for. Nothing can offer it,
 * count it, or resume after it.
 *
 * Present-but-unconnected makes it a tool call core can act on. Same name, same
 * schema, so the model reaches for it exactly as it would the real thing; only
 * the description differs, saying it is not connected and that calling it asks
 * the person. When it fires, CORE emits the card. The model is not consulted
 * about whether to show one — it decided to attempt the work, and a tool call
 * with no credential behind it is that decision.
 *
 * Modelled on `hitl.ts`, which already emits a typed event and tells the model
 * the run is waiting on a human.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Capability } from '../capabilityLedger';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { saveIntent } from '../connectionIntent';

/**
 * What the card offers, derived from the ledger state.
 * @param capability
 */
function offerFor(capability: Capability): 'connect' | 'needs-admin' | 'reconnect' | null {
  switch (capability.state.kind) {
    case 'connectable': return 'connect';
    case 'needs-admin': return 'needs-admin';
    case 'broken': return 'reconnect';
    // `ready` never reaches a stub, and `unavailable` has nothing to offer:
    // a connector this build does not ship cannot be connected by anybody.
    default: return null;
  }
}

/**
 * The vendor scopes the card asks for, derived from the TOOL rather than fixed
 * per connector.
 *
 * Consent stays minimal this way: reading a calendar asks for
 * `calendar.readonly`, and only a later write triggers an incremental consent
 * for the write scope. A tool the connector did not list falls back to
 * `default`.
 * @param connectorSlug - Which connector.
 * @param toolName - The tool the model was about to call.
 */
export function scopesFor(connectorSlug: string, toolName: string): string[] {
  const scopes = getConnector(connectorSlug)?.scopes;
  return [...(scopes?.[toolName] ?? scopes?.default ?? [])];
}

/**
 * Wrap a real tool as a stub that offers the connection instead of running.
 *
 * The description prefix is the only thing the model is told, and it is
 * deliberate: it says the tool exists, says it is not connected, and says that
 * calling it puts the question to the person. A model reading that reaches for
 * the tool when the work needs it — which is the point — rather than
 * improvising a sentence about connecting things.
 * @param real - The tool this stands in for; its name and schema are reused verbatim.
 * @param capability - What the ledger says about the connector behind it.
 * @param ctx - The turn, for `emit` and tenancy.
 */
export function connectStub(
  real: StructuredToolInterface,
  capability: Capability,
  ctx: RuntimeContext,
): StructuredToolInterface {
  const offer = offerFor(capability);
  const platform = platformForConnectorSlug(capability.slug)?.id ?? null;

  return tool(
    async (args: unknown) => {
      if (offer === null) {
        return `[${capability.name} is not available in this workspace. Say so plainly and answer from what you already have.]`;
      }
      const requestedScopes = scopesFor(capability.slug, real.name);
      // What the model was ABOUT to do, saved before the card goes out. It
      // does not have to be guessed later: the tool and the arguments are
      // already decided at this exact moment, and replaying them is what makes
      // the turn that showed the card the turn that answers. Null when there
      // is nobody to resume as, or when the write failed — resume then falls
      // back to re-asking, which is still correct.
      const intentId = ctx.actor.kind === 'user'
        ? await saveIntent({
            orgId: ctx.orgId,
            userId: ctx.actor.id,
            conversationId: ctx.conversationId,
            connectorSlug: capability.slug,
            tool: real.name,
            args: (args ?? {}) as Record<string, unknown>,
            scopes: requestedScopes,
          })
        : null;
      ctx.emit({
        type: 'connect_source',
        connect: {
          connectorSlug: capability.slug,
          name: capability.name,
          icon: capability.icon,
          platform,
          scope: capability.identity === 'shared' ? 'workspace' : 'user',
          state: offer,
          authKind: capability.authKind,
          // Core's words, never the model's. What the person reads about why
          // they are being asked has to be traceable to what the turn did.
          reason: reasonFor(capability, real.name, args),
          requestedScopes,
          tool: real.name,
          intentId,
          workspaceGrantAvailable: capability.workspaceGrantAvailable,
        },
      });
      return offer === 'needs-admin'
        ? `[${capability.name} is not connected for this workspace, and connecting it is an admin's to do. A card saying so is on screen. Tell them in one line what you would do once it is connected, and answer as far as you can without it. Do not call this tool again this turn.]`
        : `[${capability.name} is not connected. A connect card is on screen. Say one line about what you will do once it is, and how they can skip it. Do not call this tool again this turn.]`;
    },
    {
      // Same name and same schema as the real tool: the model must not be able
      // to tell the difference at the point of choosing what to call.
      name: real.name,
      schema: real.schema,
      description: `[NOT CONNECTED — calling this asks the person to connect ${capability.name}; it returns no data this turn] ${real.description ?? ''}`.trim(),
    },
  ) as StructuredToolInterface;
}

/**
 * One line saying what the turn was trying to do, in core's words.
 *
 * Deliberately built from the tool name and the connector rather than from
 * anything the model wrote: the card's explanation is a claim about what
 * happened, and a model-authored one could not be checked against it.
 * @param capability - The connector.
 * @param toolName - The tool that fired.
 * @param args - What it was called with, used only to say how much was asked for.
 */
function reasonFor(capability: Capability, toolName: string, args: unknown): string {
  const verb = toolName.replace(/^[a-z]+_/, '').replaceAll('_', ' ');
  const detail = typeof args === 'object' && args !== null && Object.keys(args).length > 0
    ? ` (${Object.keys(args as Record<string, unknown>).slice(0, 3).join(', ')})`
    : '';
  return `The answer needs ${capability.name} — it was about to read ${verb}${detail}.`;
}
