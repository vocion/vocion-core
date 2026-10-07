import type { Action } from './types';
import { z } from 'zod';

/**
 * me.set_phone — the person whose turn it is gives Vocion their mobile number, in chat, and it
 * is kept on their profile (Chris, 2026-10-07: "Can you make that discoverable … ask and store
 * from chat?"). With it a text from that number is theirs: the SMS channel answers it, and a
 * reply by text decides a card as them (`services/chat/conversationChannel.ts`).
 *
 * Always the asker's own number: the person is the one behind the turn (`personBehind`: a
 * member, or a Slack, email or text sender Vocion resolves to one), never a person the words
 * name. A number another member already holds is refused. Reversible: the previous number is on
 * the run, and Undo puts it back.
 */

const ME_SET_PHONE = 'me.set_phone';

const input = z.object({
  /** The number as the person gave it; kept in E.164. */
  phone: z.string().min(7).max(40),
  reason: z.string().min(1).max(300).optional(),
});

async function setPhone(userId: string, phone: string | null): Promise<void> {
  const [{ db }, { eq }, { userSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  await db.update(userSchema).set({ phone }).where(eq(userSchema.id, userId));
}

async function phoneOf(userId: string): Promise<string | null> {
  const [{ db }, { eq }, { userSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  const [row] = await db.select({ phone: userSchema.phone }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return row?.phone ?? null;
}

async function holderOf(phone: string): Promise<string | null> {
  const [{ db }, { eq }, { userSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  const [row] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.phone, phone)).limit(1);
  return row?.id ?? null;
}

export const meSetPhoneAction: Action<typeof input> = {
  id: ME_SET_PHONE,
  name: 'Save my mobile number',
  description: 'Keep the mobile number of the person you are talking with on their own Vocion profile, so a text from it is theirs: Vocion answers it, tells them about their requests by text, and a text reply can decide a card as them. Only ever the asker\'s own number, given in their own words; ask for it ("What mobile number should texts come from?") when they want updates or approvals by text. Reversible.',
  inputSchema: input,
  grant: 'update_profile',
  external: false,
  dedupKeyFor: () => undefined,
  async precheck(ctx, i) {
    const { toE164 } = await import('@/libs/phone');
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    if (!person) {
      return 'Only a person Vocion knows can keep a number on their profile, and this turn is not one. Ask them to sign in to Vocion with the email they use here.';
    }
    const phone = toE164(i.phone);
    if (!phone) {
      return `"${i.phone}" is not a phone number Vocion can text. Ask for it with its country code (+1 for the US).`;
    }
    const holder = await holderOf(phone);
    if (holder && holder !== person.userId) {
      return 'That number is already on another member\'s profile. Ask the person to check it.';
    }
    return undefined;
  },
  async reviewCard(ctx, i) {
    const { toE164 } = await import('@/libs/phone');
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    return {
      title: 'Save a mobile number',
      system: 'Profile',
      ...(i.reason ? { summary: i.reason } : {}),
      fields: [
        { label: 'Person', value: person ? `${person.name} (${person.email})` : 'the person in this conversation' },
        { label: 'Number', value: toE164(i.phone) ?? i.phone },
      ],
      nextAction: 'Approving keeps this number on their profile; texts from it are theirs. Undo removes it.',
      verbs: { approve: 'Save the number', reject: 'Don\'t save' },
    };
  },
  async execute(ctx, i) {
    const { toE164 } = await import('@/libs/phone');
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    const phone = toE164(i.phone);
    if (!person || !phone) {
      throw new Error(!person ? 'No Vocion person behind this turn.' : `"${i.phone}" is not a phone number.`);
    }
    const holder = await holderOf(phone);
    if (holder && holder !== person.userId) {
      throw new Error('That number is already on another member\'s profile.');
    }
    const previous = await phoneOf(person.userId);
    await setPhone(person.userId, phone);
    return { userId: person.userId, phone, previous, line: `Saved ${phone} on ${person.name}'s profile; texts from it are theirs.` };
  },
  async undo(_ctx, _i, result) {
    const userId = typeof result?.userId === 'string' ? result.userId : null;
    if (!userId) {
      throw new Error('This run recorded no person, so there is nothing to restore.');
    }
    const previous = typeof result?.previous === 'string' ? result.previous : null;
    await setPhone(userId, previous);
    return { restored: previous, line: previous ? `Put back ${previous}.` : 'Removed the number.' };
  },
};
