/**
 * pin_to_sidebar — "pin this page", said to the agent.
 *
 * The person's word runs (CLAUDE.md, "Accelerate, never block"): the pin is
 * proposed AS the person whose turn it is, through the `nav.pin` action, so
 * it runs at once, lands as a Done line under the turn with Undo, and puts
 * no card in front of them. It only ever touches that person's own sidebar
 * in this workspace.
 *
 * "This" is read from where the person is (`page_context`): the thread on the
 * chat page, the doc, room or record on the page beside the rail. An explicit
 * kind and id, or a path, wins over the page.
 */

import type { RuntimeContext } from '../types';
import type { PinTarget } from '@/libs/pins/pinTarget';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PIN_KINDS } from '@/libs/pins/pinTarget';

const ACTION_ID = 'nav.pin';

/**
 * What to pin: the named target, else a path, else the page the person is on.
 * @param ctx - The turn.
 * @param args - The tool's arguments.
 * @param args.kind - Named kind.
 * @param args.id - Named id.
 * @param args.path - A page path.
 */
async function chooseTarget(ctx: RuntimeContext, args: { kind?: PinTarget['kind']; id?: string; path?: string }): Promise<PinTarget | null> {
  if (args.kind && args.id) {
    return { kind: args.kind, id: args.id };
  }
  const { targetForPath } = await import('@/services/pins/PinService');
  const path = args.path ?? ctx.pageContext?.path;
  const fromPath = path ? await targetForPath(ctx.orgId, path) : null;
  if (fromPath) {
    return fromPath;
  }
  // The chat page does not always carry its thread in the address.
  if (!args.path && ctx.conversationId && /\/dashboard\/chat(?:[/?#]|$)/.test(ctx.pageContext?.path ?? '')) {
    return { kind: 'conversation', id: String(ctx.conversationId) };
  }
  return null;
}

export function pinToSidebarTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { kind, id, path, unpin } = args as { kind?: PinTarget['kind']; id?: string; path?: string; unpin?: boolean };
      if (!ctx.userId) {
        return 'Not pinned: a sidebar belongs to a person, and no one is signed in behind this turn.';
      }
      const target = await chooseTarget(ctx, { kind, id, path });
      if (!target) {
        return 'Not pinned: the page the person is on is not one thing that can be pinned (a conversation, an artifact, a wiki page, a data room, a saved view, a record or an app page). Ask which one they mean, or pass kind and id.';
      }
      const input = { kind: target.kind, id: target.id, ...(unpin ? { unpin: true } : {}) };
      try {
        const { proposeAction } = await import('@/services/ActionService');
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: ACTION_ID,
          input,
          principal: { kind: 'user', id: ctx.userId, role: 'member', scope: { orgId: ctx.orgId } },
          invokedBy: ctx.userId,
          origin: ctx.conversationId ? { conversationId: ctx.conversationId, userId: ctx.userId, byPerson: true } : undefined,
          proposal: {
            confidence: 0.95,
            rationale: unpin ? 'The person asked to unpin it.' : 'The person asked to pin it.',
            suggestedDecision: 'approve',
            suggestedDecisionReason: 'Their own sidebar, on their word.',
            agentSlug: ctx.agentSlug,
          },
        });
        const result = (res.result ?? {}) as { title?: string; href?: string; line?: string; changed?: boolean };
        if (res.status === 'done') {
          const title = result.title ?? `${target.kind} ${target.id}`;
          ctx.emit({
            type: 'receipt',
            receipt: { runId: res.runId, actionId: ACTION_ID, label: unpin ? `Unpinned ${title}` : `Pinned ${title} to your sidebar`, undoable: true, ...(result.href?.startsWith('/') ? { href: result.href } : {}) },
          });
          return `${result.line ?? 'Done.'} It is in their sidebar now${unpin ? '' : ', under Pinned'}; a person can undo it from the Done line under this turn. Say so in one line.`;
        }
        return `The pin is waiting on the person's approval (run #${res.runId}). Do not say it is pinned.`;
      } catch (error) {
        return `Not pinned: ${(error as Error).message}`;
      }
    },
    {
      name: 'pin_to_sidebar',
      description: 'Pin something to the person\'s OWN sidebar in this workspace (or unpin it with unpin: true) when they ask — "pin this", "pin this chat", "keep this in my sidebar". With no arguments it pins what the person is looking at (the open conversation, doc, wiki page, data room, record or page). Runs at once with Undo. Never pins for anyone else.',
      schema: z.object({
        kind: z.enum(PIN_KINDS).optional().describe('What it is, when it is not the page the person is on.'),
        id: z.string().min(1).max(200).optional().describe('Its id (a row id; a slug for a view or page; `<page>/<slug>` for a wiki page). Pass with kind.'),
        path: z.string().min(1).max(500).optional().describe('An in-app path to pin instead, e.g. /dashboard/rooms/12.'),
        unpin: z.boolean().optional().describe('Take it out of the sidebar instead.'),
      }),
    },
  );
}
