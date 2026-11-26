/**
 * `zendesk.create_ticket`: hand the conversation to a person by opening one
 * Zendesk ticket for the end user who tapped the agent's card.
 *
 * The agent writes the subject, the summary and a topic name on the card, and
 * this schema checks them before the card shows. Everything else comes from
 * outside the model:
 *   - the requester is the end user who tapped (`ctx.caller`, set by
 *     `run_workspace_card`), so the action refuses to run without one;
 *   - the tags and subject prefix come from the zendesk source's `tickets`
 *     settings (`libs/zendesk/ticketSettings.ts`);
 *   - the conversation is the one the card was put up in (`ctx.origin`).
 *
 * One open ticket per conversation, retries that can only get the same
 * ticket, and the Zendesk calls live in `services/handoff/ticketHandoff.ts`.
 *
 * The credential is the workspace's source with slug `zendesk` (`sourceSlug`).
 */
import type { Action } from './types';
import { z } from 'zod';
import { zendeskCredentialsFrom } from '@/libs/zendesk/client';
import { helpCenterSettingsFrom, resolveHelpCenterTarget } from '@/libs/zendesk/helpCenterSettings';
import { zendeskTicketSettingsSchema } from '@/libs/zendesk/ticketSettings';
import { handOffToTicket, sourceConfigFor } from '@/services/handoff/ticketHandoff';
import { CardCallerSchema } from './cardRunnable';

/** The slug of the source whose credential and settings this action uses. */
export const ZENDESK_TICKET_SOURCE_SLUG = 'zendesk';

export const zendeskCreateTicketInput = z.object({
  /** The ticket's subject, as the agent wrote it. The source's prefix goes in front. */
  subject: z.string().trim().min(1).max(150),
  /** What the end user needs, written for the person who picks the ticket up. The ticket's first comment. */
  summary: z.string().trim().min(1).max(4000),
  /** A topic name from the source's `tickets.topicTags`. An unknown one gets the fallback tag. */
  topic: z.string().trim().min(1).max(60),
}).strict();

export const zendeskCreateTicketAction: Action<typeof zendeskCreateTicketInput> = {
  id: 'zendesk.create_ticket',
  name: 'Create a Zendesk ticket',
  description: 'Hand the conversation to a person: open one Zendesk ticket for the end user who tapped the card, with a subject, a summary for the person who picks it up, and a topic. A conversation gets one open ticket: tapping again while it is unsolved returns the same ticket. Runs only from a card an end user taps.',
  inputSchema: zendeskCreateTicketInput,
  cardRunnable: { callerSchema: CardCallerSchema },
  grant: 'create_ticket',
  external: true,
  sourceSlug: ZENDESK_TICKET_SOURCE_SLUG,
  async execute(ctx, input) {
    if (!ctx.caller) {
      throw new Error('zendesk.create_ticket runs only from a card an end user tapped (run_workspace_card), because the ticket is filed for that person.');
    }
    const conversationId = ctx.origin?.conversationId;
    if (typeof conversationId !== 'number') {
      throw new TypeError('zendesk.create_ticket needs the conversation the card was put up in, and this run has none.');
    }
    const credentials = zendeskCredentialsFrom(ctx.credentials);
    if (!credentials.ok) {
      throw new Error(`zendesk.create_ticket needs the "${ZENDESK_TICKET_SOURCE_SLUG}" source's credential: ${credentials.message}`);
    }
    const configJson = await sourceConfigFor(ctx.orgId, ZENDESK_TICKET_SOURCE_SLUG);
    if (configJson === undefined) {
      throw new Error(`zendesk.create_ticket needs a source with slug "${ZENDESK_TICKET_SOURCE_SLUG}" in this workspace.`);
    }
    const tickets = zendeskTicketSettingsSchema.safeParse((configJson as { tickets?: unknown }).tickets);
    if (!tickets.success) {
      throw new Error(`The "${ZENDESK_TICKET_SOURCE_SLUG}" source needs a valid tickets block (topicTags, fallbackTopicTag, tags, subjectPrefix) before it can open tickets: ${z.prettifyError(tickets.error)}`);
    }
    const helpCenter = helpCenterSettingsFrom(configJson);
    if (!helpCenter.ok) {
      throw new Error(helpCenter.message);
    }
    const target = resolveHelpCenterTarget(helpCenter.settings, credentials.credentials.subdomain);
    if (!target.ok) {
      throw new Error(target.message);
    }
    const handedOff = await handOffToTicket({
      orgId: ctx.orgId,
      conversationId,
      sourceSlug: ZENDESK_TICKET_SOURCE_SLUG,
      caller: ctx.caller,
      ticket: input,
      credentials: credentials.credentials,
      settings: tickets.data,
      requestUrlBase: `${target.target.origin}/hc/${target.target.locale}/requests/`,
    });
    return { ...handedOff };
  },
};
