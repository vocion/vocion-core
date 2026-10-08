/**
 * `crm.add_note` — log a note on a record in the connected CRM (Salesforce,
 * Pipedrive, Attio): a call summary on the deal, what a contact asked for,
 * the next step agreed. In Salesforce it is a completed Task on the record,
 * the CRM's own "logged activity"; in Pipedrive and Attio, a note.
 *
 * External, with the words on the card as an editable message, so a person
 * vouches for what the CRM will say. Undo deletes the note.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const CRM_ADD_NOTE_ACTION_ID = 'crm.add_note';

const noteInput = z.object({
  object: z.enum(['account', 'contact', 'deal']).describe('account, contact or deal.'),
  id: z.string().min(1).max(64).describe('The record id, from crm_search_records or crm_get_record — never a name.'),
  text: z.string().min(1).max(20_000).describe('The note, plain text; paragraphs separated by a blank line.'),
  title: z.string().max(200).optional().describe('A short title (Salesforce shows it as the activity\'s subject).'),
  source: z.string().max(80).optional().describe('The CRM source, when the workspace has more than one.'),
  record_name: z.string().max(200).optional().describe('The record\'s name, for the card.'),
});

type Input = z.infer<typeof noteInput>;

export const crmAddNoteAction: Action<typeof noteInput> = {
  id: CRM_ADD_NOTE_ACTION_ID,
  name: 'Log a note in the CRM',
  description: 'Log a note on an account, contact or deal in the connected CRM (Salesforce, Pipedrive or Attio): a call summary, the next step agreed. Undo deletes the note.',
  inputSchema: noteInput,
  grant: 'update_crm',
  external: true,
  async reviewCard(_ctx, raw): Promise<ReviewCard> {
    const input = raw as Input;
    const subject = input.record_name ?? `${input.object} ${input.id}`;
    return {
      title: `Note on ${subject}`,
      system: 'CRM',
      headline: `Approving logs this note on ${subject} in the CRM now. Undo deletes it.`,
      badges: [{ label: 'CRM' }, { label: 'Undo deletes the note' }],
      contentHeading: { label: input.title ?? 'Note' },
      content: [{ kind: 'message' as const, id: 'note', label: 'Note', body: input.text }],
      fields: [{ label: 'Record', value: `${input.object} ${input.id}${input.source ? ` (${input.source})` : ''}` }],
      nextAction: 'Approving writes the note now.',
      verbs: { approve: 'Approve & log', reject: 'Decline' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'note');
    return edit?.body === undefined ? input : { ...input, text: edit.body };
  },
  async execute(ctx, input) {
    const { crmProviderFor } = await import('@/services/crm/provider');
    const provider = await crmProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
    const note = await provider.addNote(input.object, input.id, { title: input.title, text: input.text });
    return {
      logged: true,
      crm: provider.kind,
      source: provider.sourceSlug,
      noteId: note.id,
      url: note.url,
      line: `Logged a note on ${input.record_name ?? `${input.object} ${input.id}`} in ${provider.kind}.`,
    };
  },
  async undo(ctx, input, result) {
    const noteId = typeof result.noteId === 'string' ? result.noteId : null;
    if (!noteId) {
      throw new Error('This run recorded no note, so there is nothing to take back.');
    }
    const source = typeof result.source === 'string' ? result.source : input.source ?? null;
    const { crmProviderFor } = await import('@/services/crm/provider');
    const provider = await crmProviderFor(ctx.orgId, { sourceSlug: source });
    await provider.deleteNote(noteId);
    return { deleted: true, noteId, line: `Deleted the note from ${input.record_name ?? `${input.object} ${input.id}`}.` };
  },
};
