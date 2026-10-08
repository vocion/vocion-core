/**
 * `phone.place_call` — ring a person and say a message, from one of the workspace's numbers.
 *
 * A call reaches a real person's phone the moment it is placed and cannot be taken back, so it
 * waits for a person every time: `approvalRequired`, and on the never-auto list
 * (`neverAuto.ts`) so no trust rule can release it. There is no Undo — a placed call has rung.
 * The card shows the words the call will say, editable before approving.
 *
 * Twilio today (the `twilio` platform, the workspace's account first and the server's second);
 * the call says the message with Twilio's text-to-speech and hangs up.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';
import { toE164 } from '@/libs/phone';

export const PLACE_CALL_ACTION_ID = 'phone.place_call';

const placeCallInput = z.object({
  to: z.string().min(1).describe('Who to call, with the country code (+1 970 555 0100).'),
  from: z.string().min(1).describe('One of the workspace\'s numbers on its phone account, with the country code.'),
  say: z.string().min(1).max(1000).describe('What the call says, in full, before it hangs up.'),
  about: z.string().min(1).max(200).optional().describe('The record the call is about (request:12), so two pending calls about it are one card.'),
});

type Input = z.infer<typeof placeCallInput>;

/**
 * Both numbers as E.164, or the sentence that says which one is not a number.
 * @param input - The proposal.
 */
function numbersOf(input: Pick<Input, 'to' | 'from'>): { to: string; from: string } | string {
  const to = toE164(input.to);
  const from = toE164(input.from);
  if (!to) {
    return `${input.to} is not a phone number I can dial; give it with its country code.`;
  }
  if (!from) {
    return `${input.from} is not one of the workspace's numbers; give it with its country code.`;
  }
  return { to, from };
}

export const phonePlaceCallAction: Action<typeof placeCallInput> = {
  id: PLACE_CALL_ACTION_ID,
  name: 'Place a phone call',
  description: 'Call a person from one of the workspace\'s numbers and say a message, then hang up. A person approves every call; it cannot be undone.',
  inputSchema: placeCallInput,
  grant: 'place_call',
  external: true,
  approvalRequired: true,
  dedupKeyFor: (input) => {
    const n = numbersOf(input);
    return typeof n === 'string' ? undefined : `${PLACE_CALL_ACTION_ID}:${n.to}:${input.about ?? input.say.slice(0, 80)}`.toLowerCase();
  },
  async precheck(ctx, input) {
    const n = numbersOf(input);
    if (typeof n === 'string') {
      return n;
    }
    const { twilioCredentialsFor } = await import('@/libs/twilio/client');
    if (!(await twilioCredentialsFor(ctx.orgId))) {
      return 'This workspace has no phone account to call from. Connect Twilio at /dashboard/connectors and propose again.';
    }
    return undefined;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const n = numbersOf(input);
    const to = typeof n === 'string' ? input.to : n.to;
    return {
      title: input.about ? `Call ${to} — ${input.about}` : `Call ${to}`,
      system: 'Phone',
      headline: `Approving rings ${to} now and says this message. It cannot be undone.`,
      badges: [{ label: 'Phone' }, { label: 'Irreversible', tone: 'warn' }],
      contentHeading: { label: 'What the call says' },
      content: [{ kind: 'message', id: 'say', label: 'Message', body: input.say }],
      fields: [
        { label: 'To', value: to },
        { label: 'From', value: typeof n === 'string' ? input.from : n.from },
        ...(input.about ? [{ label: 'About', value: input.about }] : []),
      ],
      nextAction: `Approving rings ${to} now and says this message. It cannot be undone.`,
      verbs: { approve: 'Approve & call', reject: 'Don\'t call' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'say');
    return edit?.body === undefined ? input : { ...input, say: edit.body };
  },
  async execute(ctx, input) {
    const n = numbersOf(input);
    if (typeof n === 'string') {
      throw new TypeError(n);
    }
    const { placeTwilioCall, twilioCredentialsFor } = await import('@/libs/twilio/client');
    const creds = await twilioCredentialsFor(ctx.orgId);
    if (!creds) {
      throw new Error('This workspace has no phone account to call from. Connect Twilio at /dashboard/connectors.');
    }
    const placed = await placeTwilioCall(creds, { from: n.from, to: n.to, say: input.say });
    if (!placed.ok) {
      throw new Error(`The call was not placed: ${placed.message}`);
    }
    return { placed: true, callSid: placed.data.sid, status: placed.data.status, line: `Called ${n.to} from ${n.from} (call ${placed.data.sid}).` };
  },
};
