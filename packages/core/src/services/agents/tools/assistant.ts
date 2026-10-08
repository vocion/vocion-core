/**
 * A PERSON'S OWN ASSISTANT REACHES THEIR WORKSPACES (Vocion 5.0, phase 2a).
 *
 * The assistant lives in the person's personal workspace. These two tools are
 * how it works anywhere else:
 *
 * - `list_my_workspaces` — the shared workspaces on this account the person
 *   can act in, each with what it is for and who answers there.
 * - `ask_workspace` — put a question (or a request) to one of them. The
 *   workspace's own lead answers, in a conversation of that workspace's own
 *   (`surface: 'assistant'`, linked to this thread by
 *   `parent_conversation_id`), created by the person, run as the person
 *   (`runAgentDeep({ orgId: <that workspace>, userId: <the person> })` through
 *   `askWorkspace`). It is a nested TURN, not a subagent: a subagent shares
 *   the asking agent's tools and `orgId`, and the whole point is that the work
 *   runs in the other workspace, under its own tools, trust rules and budget.
 *
 * Talk is private, work lands in the workspace: this thread stays the
 * person's alone, and what the workspace was asked, what it answered and any
 * card or question it raised are that workspace's records, visible to its
 * members. The answer comes back with links built by `workspaceUrl`, so the
 * person is one move from acting on it.
 *
 * A proposal it filed that waits on the person comes back as a CARD, here:
 * the same card, put up in this thread with the workspace it lives in
 * (`card.workspace`), decided from here as the person (`actAs`,
 * `routers/actingWorkspace.ts`) while the run stays in the workspace's review
 * queue. Only a run still `pending` is a card: one that already ran (the
 * person's word runs, with undo), failed or was turned down is not waiting on
 * anyone, and its line in the answer says how it stands.
 *
 * The links come back on every surface. Only the app's chat draws a card
 * (`ctx.rendersCards`); a text, a Slack thread or an email gets the turn's
 * words alone. So the model is told a card is up only where one is, and it is
 * always told to give the person the links as written, so they are one move
 * from deciding wherever they read the answer.
 *
 * Identity. Both tools exist only in a personal workspace (`ctx.workspaceKind`),
 * and on every call they check that the person the turn runs for owns it
 * (`actAs(userId, ctx.orgId)`) and may act in the workspace asked
 * (`actAs(userId, <workspace>)`). In process, `userId` is the signed-in
 * person; over the container's tool endpoint it comes only from the signed
 * claim (`toolEndpoint.ts`). Anything that fails reads "not found", never
 * "not yours", so a workspace's existence is not disclosed by asking for it.
 *
 * The work shows live. The ask is one delegate row in this turn's activity
 * ("Asking Northwind Factory", then "Asked Northwind Factory · Factory Lead
 * answered"), and the workspace's own steps indent beneath it as they happen
 * (agent-chat-surface.md §2, §9). The row is drawn here, not by the trace
 * emitter, because only this tool knows the workspace's name and the id its
 * steps hang under (`SELF_TRACED_TOOLS` in `traceEmitter.ts`). It names both
 * tenses (`labels`), and the phrase it adds to a folded group's line in both
 * tenses (`headline`), so the group says "asked Northwind Factory" as written
 * (`libs/chat/stepHeadline.ts`).
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentEvent, RuntimeContext, TraceActor, TraceNodeEvent } from '../types';
import type { Card, CardWorkspace } from '@/libs/cards/card';
import type { TurnAction } from '@/services/chat/workspaceTurn';
import type { ActingWorkspace } from '@/services/workspace/actingWorkspaces';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { readCard } from '@/libs/cards/card';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { describeWorkspaces, readWorkspaceRoute, routePrompt, WORKSPACE_ROUTE_BAR } from '@/services/chat/workspaceRoute';
import { askWorkspace, WorkspaceTurnError } from '@/services/chat/workspaceTurn';
import { workspaceAddressById } from '@/services/ProjectService';
import { actAs } from '@/services/workspace/actAs';
import { listActingWorkspaces, resolveActingWorkspace } from '@/services/workspace/actingWorkspaces';

/**
 * The one answer for a workspace that is not reachable, whatever the reason.
 * @param ref - The workspace as it was named.
 */
function notFound(ref: string): string {
  return `No workspace "${ref}" is one you can reach from here. Call list_my_workspaces for the ones you can ask.`;
}

/**
 * Who this turn runs for, when they own the personal workspace it runs in.
 * Null for anyone else and for a turn with no person (a schedule): those reach
 * no other workspace.
 * @param ctx - The turn.
 */
async function owner(ctx: RuntimeContext): Promise<{ userId: string; accountId: string } | null> {
  if (!ctx.userId) {
    return null;
  }
  const home = await actAs(ctx.userId, ctx.orgId);
  return home ? { userId: ctx.userId, accountId: home.accountId } : null;
}

/**
 * How the person is named to the workspace being asked: their name, else the
 * part of their address before the `@`.
 * @param userId - The person.
 */
async function personName(userId: string): Promise<string> {
  const [row] = await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return row?.name?.trim() || row?.email?.split('@')[0] || 'Someone';
}

/**
 * One line per workspace, as the model reads it.
 * @param w - The workspace.
 */
function workspaceLine(w: ActingWorkspace): string {
  const lead = w.lead ? ` — answered by ${w.lead.name}${w.lead.description ? ` (${w.lead.description.replace(/\s+/g, ' ').slice(0, 120)})` : ''}` : '';
  const about = w.description ? ` — ${w.description.replace(/\s+/g, ' ').slice(0, 200)}` : '';
  return `- ${w.name} (workspace: ${w.slug})${about}${lead}`;
}

export function listMyWorkspacesTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const who = await owner(ctx);
      const list = who ? await listActingWorkspaces(who.userId, who.accountId) : [];
      if (list.length === 0) {
        return 'There is no shared workspace on this account that you can ask yet.';
      }
      return [
        `The shared workspaces you can ask (${list.length}). Ask one with ask_workspace, naming it by its workspace slug:`,
        ...list.map(workspaceLine),
      ].join('\n');
    },
    {
      name: 'list_my_workspaces',
      description: 'The shared workspaces the person you work for can act in, with what each is for and who answers there. Read it before choosing which workspaces to ask.',
      schema: z.object({}),
    },
  );
}

/** What the routing read is told when the assistant did not name a workspace. */
const ASSISTANT_ROUTE_SYSTEM = 'A person\'s own assistant needs something answered by one of the shared workspaces they belong to. Each workspace is for different products, teams or clients. Decide which one the message is for, from what it is about — the product, the work, the people or the agents it names. If nothing points to one, say so with a low confidence. Answer only through the tool.';

/**
 * The workspace to ask when none was named: the only one there is, or the one
 * a small model reads the message as being for, at the same bar a Slack
 * mention is routed at. Meaning is read, never matched.
 * @param ctx - The turn, whose workspace pays for the read.
 * @param list - The person's workspaces.
 * @param message - What is being asked.
 */
async function pickWorkspace(ctx: RuntimeContext, list: ActingWorkspace[], message: string): Promise<{ picked: ActingWorkspace } | { unsure: string }> {
  if (list.length === 1) {
    return { picked: list[0]! };
  }
  const candidates = await describeWorkspaces(list.map(w => ({ id: w.id, name: w.name, description: w.description })));
  const read = candidates.length > 0
    ? await readWorkspaceRoute(ctx.orgId, routePrompt(message, candidates, { channel: null, own: [], via: 'that the assistant needs answered' }), { system: ASSISTANT_ROUTE_SYSTEM }).catch(() => null)
    : null;
  const picked = read && read.confidence >= WORKSPACE_ROUTE_BAR ? list.find(w => w.id === read.workspace.trim()) : undefined;
  if (picked) {
    return { picked };
  }
  return { unsure: read?.reason ?? 'nothing in the message points to one of them' };
}

/**
 * A step of the asked workspace's turn, hung beneath the ask's own row. Its
 * ids are prefixed so they can never collide with this turn's own, and every
 * actor in it is a specialist of this turn.
 * @param event - The workspace's step.
 * @param rowId - The ask's row.
 */
export function nestUnder(event: TraceNodeEvent, rowId: string): TraceNodeEvent {
  const inner = (id: string) => `${rowId}:${id}`;
  return {
    ...event,
    id: inner(event.id),
    parentId: event.parentId ? inner(event.parentId) : rowId,
    actor: { ...event.actor, id: inner(event.actor.id), kind: 'specialist' },
    ...(event.citations ? { citations: event.citations.map(c => ({ ...c, actorId: inner(c.actorId) })) } : {}),
  };
}

/**
 * What the asked workspace filed, as a card for this thread: the same action
 * card a turn in that workspace would put up, already filed (`runId`), naming
 * the workspace its run lives in so the card reads and decides it there.
 * Null for anything that is not waiting on the person as a proposal — a run
 * already decided, a filed question (answered on its own page) — and for a
 * filing the card contract refuses (no action to press); each of those is left
 * to its link in the tool's text.
 * @param action - One run the asked workspace's turn filed.
 * @param workspace - Where it lives.
 */
export function raisedCard(action: TurnAction, workspace: CardWorkspace): Card | null {
  // A run that ran, failed or was turned down is decided: a card would ask
  // the person to decide it again (Accelerate 1: their word runs, no card).
  if (action.status !== 'pending' || action.askId !== null) {
    return null;
  }
  const checked = readCard({
    // One run, one card: the same run brought back twice is the same card.
    id: `card_run${action.id}`,
    kind: 'action',
    title: action.title,
    actions: action.actionId ? [{ label: action.title, actionId: action.actionId, input: action.input, style: 'primary' }] : [],
    source: { ...(action.agentSlug ? { agentSlug: action.agentSlug } : {}), tool: 'ask_workspace' },
    runId: action.id,
    workspace,
    // Filed, never `proposed`: a proposed card hands the turn to the person
    // and ends it (`agents/handOff.ts`), and the assistant still owes its answer.
    state: 'filed',
    ...(action.rationale ? { rationale: action.rationale } : {}),
    ...(action.confidence !== null ? { confidence: action.confidence } : {}),
    ...(action.suggestedDecision && action.suggestedDecisionReason ? { suggestedDecision: action.suggestedDecision, suggestedDecisionReason: action.suggestedDecisionReason } : {}),
  });
  return checked.ok ? checked.card : null;
}

export function askWorkspaceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { workspace: named, message } = args as { workspace?: string; message: string };
      const who = await owner(ctx);
      const ref = named?.trim() ?? '';
      if (!who) {
        return notFound(ref || 'any');
      }

      let target: ActingWorkspace;
      if (ref) {
        const found = await resolveActingWorkspace(who.userId, who.accountId, ref);
        if (!found) {
          return notFound(ref);
        }
        target = found.workspace;
      } else {
        const list = await listActingWorkspaces(who.userId, who.accountId);
        if (list.length === 0) {
          return 'There is no shared workspace on this account that you can ask yet.';
        }
        const choice = await pickWorkspace(ctx, list, message);
        if ('unsure' in choice) {
          return [
            `Could not tell which workspace this is for: ${choice.unsure}. Ask the person, or ask the ones it could be for, naming each:`,
            ...list.map(workspaceLine),
          ].join('\n');
        }
        target = choice.picked;
      }
      // Every ask, not only the lookup: a grant removed a second ago is gone.
      const identity = await actAs(who.userId, target.id);
      if (!identity || identity.accountId !== who.accountId) {
        return notFound(ref || target.slug);
      }

      // The ask's row in this turn's activity, with the workspace's steps
      // beneath it as they happen.
      const rowId = `ask-${randomUUID()}`;
      const actor: TraceActor = { id: 'lead', kind: 'lead', name: ctx.agentSlug ?? 'Assistant' };
      // Both tenses name the ask; who answered is the row's result.
      const labels = { running: `Asking ${target.name}`, done: `Asked ${target.name}` };
      // What the ask adds to a folded group's line, as written: the workspace's
      // name is a proper noun, so the line never re-cases it.
      const headline = { running: `asking ${target.name}`, done: `asked ${target.name}` };
      const row = (status: TraceNodeEvent['status'], extra: Partial<TraceNodeEvent> = {}): AgentEvent => ({
        type: 'trace_node',
        id: rowId,
        actor,
        kind: 'delegate',
        status,
        label: status === 'error' ? `${target.name} could not answer` : status === 'done' ? labels.done : labels.running,
        labels,
        headline,
        detail: message.replace(/\s+/g, ' ').trim().slice(0, 140),
        tool: 'ask_workspace',
        ...extra,
      });
      ctx.emit(row('start'));

      const asker = await personName(who.userId);
      try {
        const result = await askWorkspace({
          orgId: identity.orgId,
          message,
          // The person, not their assistant: the workspace runs this turn as
          // them, under their own source access, and records them as its author.
          actorId: who.userId,
          ...(target.lead ? { agentSlug: target.lead.slug } : {}),
          title: `${asker}'s assistant asked: ${message.replace(/\s+/g, ' ').trim()}`.slice(0, 120),
          surface: 'assistant',
          ...(ctx.conversationId !== undefined ? { parentConversationId: ctx.conversationId } : {}),
          note: `\n\n--- how I am reaching you ---\nThis was asked by ${asker}'s own assistant, on ${asker}'s behalf, from their personal workspace. ${asker} reads your answer through it: put the whole answer in the text and cite what you read inline. ${ctx.rendersCards
            ? `A card you file stays here in ${target.name} as its record, and ${asker} sees it as a card in their own thread and can decide it there`
            : `A card or a question you raise stays here in ${target.name}, where ${asker} decides it from the link their assistant gives them`}; say in words that you raised it. This conversation is ${target.name}'s record and its members can open it.`,
          onEvent: (event) => {
            if (event.type === 'trace_node') {
              ctx.emit(nestUnder(event, rowId));
            }
          },
        });
        ctx.emit(row('done', { result: result.truncated ? `${result.agentName} answered in part` : `${result.agentName} answered` }));

        // What it filed and still waits on the person comes back as a card
        // in this thread, decidable here; the runs stay in the workspace's
        // review queue. A filed question waits as the QUESTION, answered on
        // its own page there (the link below), not as the run that filed it.
        const address = result.actions.length > 0 ? await workspaceAddressById(identity.orgId) : null;
        const where: CardWorkspace = { id: identity.orgId, slug: target.slug, name: target.name, ...(address ? { accountSlug: address.accountSlug } : {}) };
        let carded = 0;
        for (const a of result.actions) {
          const card = raisedCard(a, where);
          if (card) {
            ctx.emit({ type: 'card', card });
            carded += 1;
          }
        }
        // Said to be on screen only where the surface draws it; the links go
        // to the person on every surface, so they can act in one move.
        const onScreen = ctx.rendersCards === true ? carded : 0;

        const raised = result.actions.map((a) => {
          const what = a.askId !== null ? 'A question for you' : `Proposed ${a.actionId}`;
          return `- ${a.url ? `[${what}](${a.url})` : what} — ${a.status}`;
        });
        return [
          `${target.name} answered (${result.agentName})${result.truncated ? ', in part: the rest lands in its conversation when it finishes' : ''}.`,
          `Its record of this ask, for the person to open: [${target.name} conversation](${result.url})`,
          '',
          result.reply.trim() || '(no answer in words)',
          ...(raised.length > 0
            ? ['', onScreen > 0
                ? `Raised in ${target.name} — ${onScreen === 1 ? 'the proposal waiting on the person is' : `the ${onScreen} proposals waiting on the person are`} on ${onScreen === 1 ? 'a card' : 'cards'} in this thread now, where they can decide ${onScreen === 1 ? 'it' : 'them'}; the record stays in ${target.name}. Say in a line what is waiting on them, and give them these links as written:`
                : `Raised in ${target.name} — these stay there, where the person decides what is waiting on them; say in a line what that is, and give them these links as written:`, ...raised]
            : []),
        ].join('\n');
      } catch (error) {
        const reason = error instanceof WorkspaceTurnError
          ? error.message
          : 'the workspace could not run the turn';
        if (!(error instanceof WorkspaceTurnError)) {
          console.warn('ask_workspace: the asked workspace\'s turn failed', { workspace: target.id }, error);
        }
        ctx.emit(row('error', { result: reason.slice(0, 160) }));
        return `${target.name} could not answer: ${reason}. Tell the person, plainly, and offer to ask again or to ask another workspace.`;
      }
    },
    {
      name: 'ask_workspace',
      description: [
        'Ask one of the person\'s shared workspaces something, on their behalf. The workspace\'s own lead answers in a conversation that becomes that workspace\'s record; you get the answer back with a link to it and to any card or question it raised there.',
        'Name the workspace by the slug list_my_workspaces gave you. Leave it out only when you cannot tell which one: a reader then picks the workspace the message is about, or tells you it could not.',
        'To consult several workspaces, call this once for each, in parallel.',
      ].join(' '),
      schema: z.object({
        workspace: z.string().optional().describe('The workspace to ask: its slug from list_my_workspaces. Omit only when you cannot tell.'),
        message: z.string().min(1).max(4_000).describe('What to ask or ask for, written so it reads well as that workspace\'s record.'),
      }),
    },
  );
}

/**
 * The assistant's tools — present only for an agent in a personal workspace.
 * @param ctx - The turn.
 */
export function assistantTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (ctx.workspaceKind !== 'personal') {
    return [];
  }
  return [listMyWorkspacesTool(ctx), askWorkspaceTool(ctx)] as StructuredToolInterface[];
}
