/**
 * `support.draft_reply` — a reply to a customer, drafted on their ticket for
 * a person on the support team to send.
 *
 * The draft lands as an INTERNAL note on the ticket (a private comment on
 * Zendesk, an admin note on Intercom, a private note on Freshdesk), so the
 * customer never sees a word until a person sends it from their own desk.
 * The card carries the draft as editable copy: what is approved is what the
 * support team reads.
 *
 * No Undo, and the description says so: Zendesk and Intercom have no API to
 * delete a note, so a draft stays on the ticket's internal thread once it is
 * there. That is also why it waits for a person by the ladder's default — a
 * kind with no Undo is never done for you until it has earned it.
 *
 * Dedup is on the ticket, so a second draft for the same ticket refreshes the
 * pending card rather than stacking two.
 */

import type { Action } from './types';
import { z } from 'zod';

export const DRAFT_REPLY_ACTION_ID = 'support.draft_reply';

const draftReplyInput = z.object({
  ticketId: z.string().min(1).max(64).describe('The ticket (a conversation, on Intercom), as support_read_ticket returned it.'),
  body: z.string().min(1).max(20_000).describe('The reply, in the words the support team would send. Plain text; paragraphs separated by a blank line.'),
  source: z.string().max(80).optional().describe('The help-desk source, when the workspace has more than one.'),
});

type Input = z.infer<typeof draftReplyInput>;

export const supportDraftReplyAction: Action<typeof draftReplyInput> = {
  id: DRAFT_REPLY_ACTION_ID,
  name: 'Draft a reply on a support ticket',
  description: 'Put a drafted reply on a ticket of the connected help desk (Zendesk, Intercom or Freshdesk) as an internal note — the customer never sees it; a person on the support team edits and sends it. No Undo: help desks keep notes (Zendesk and Intercom cannot delete one), so the draft stays on the ticket\'s internal thread.',
  inputSchema: draftReplyInput,
  grant: 'support_write',
  external: true,
  dedupKeyFor: input => `${DRAFT_REPLY_ACTION_ID}:${input.source ?? ''}:${input.ticketId.trim().replace(/^#/, '')}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    try {
      const { supportProviderFor } = await import('@/services/support/provider');
      await supportProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    const id = input.ticketId.trim().replace(/^#/, '');
    return {
      title: `Draft a reply on ticket #${id}`,
      system: 'Help desk',
      headline: 'Put this draft on the ticket as an internal note for the support team to send.',
      badges: [{ label: 'Help desk' }, { label: 'Internal note — the customer does not see it' }, { label: 'No Undo', tone: 'warn' }],
      content: [{ kind: 'message' as const, id: 'body', label: 'Draft reply', body: input.body }],
      contentHeading: { label: 'Draft reply' },
      fields: [{ label: 'Ticket', value: `#${id}` }, ...(input.source ? [{ label: 'Source', value: input.source }] : [])],
      nextAction: 'Approving puts the draft on the ticket now, as an internal note.',
      verbs: { approve: 'Put the draft on the ticket', reject: 'Leave it' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'body');
    return edit?.body === undefined ? input : { ...input, body: edit.body };
  },
  async execute(ctx, input) {
    const { supportProviderFor } = await import('@/services/support/provider');
    const provider = await supportProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
    const id = input.ticketId.trim().replace(/^#/, '');
    const note = await provider.addInternalNote(id, input.body);
    return {
      drafted: true,
      desk: provider.label,
      sourceSlug: provider.sourceSlug,
      ticketId: id,
      noteId: note.noteId,
      url: note.url,
      line: `Drafted a reply on ${provider.label} ticket #${id}, as an internal note for the support team to send.`,
    };
  },
};
