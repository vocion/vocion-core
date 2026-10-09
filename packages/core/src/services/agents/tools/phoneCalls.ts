/**
 * phone_calls / phone_call — the workspace's call log, read live from whichever telephony
 * account it connected (Twilio Voice, Vonage), for any agent with one of those sources in scope.
 *
 *   phone_calls  the latest calls, newest first, optionally to or from one number and since a
 *                day: who, when, how long, how it ended.
 *   phone_call   one call: the same, plus — on Twilio — its recordings and the words of any
 *                Twilio transcribed.
 *
 * Named for the thing, not the vendor: the source a workspace connected decides who answers.
 * The index holds the same calls as documents (`libs/sources/twilioVoice.ts`,
 * `libs/sources/vonage.ts`) for search; these are for "the call that just happened". Placing a
 * call is an action (`phone.place_call`), always behind a person's approval.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { kindOfSource } from '@/libs/connectors/families';

export const PHONE_CALLS_TOOL = 'phone_calls';
export const PHONE_CALL_TOOL = 'phone_call';

/** The telephony connector kinds, first provider first. */
const TELEPHONY_KINDS = ['twilio-voice', 'vonage'] as const;

type TelephonyKind = (typeof TELEPHONY_KINDS)[number];

/**
 * The telephony accounts in this agent's reach, as connector kinds, narrowed by the person's
 * source ACL like every source-gated tool.
 * @param ctx - The turn.
 */
export function telephonyInScope(ctx: Pick<RuntimeContext, 'connectorSources' | 'allowedSourceSlugs' | 'sourceKinds'>): TelephonyKind[] {
  const allowed = ctx.allowedSourceSlugs ? new Set(ctx.allowedSourceSlugs) : null;
  const kinds = ctx.connectorSources
    .filter(slug => !allowed || allowed.has(slug))
    .map(slug => kindOfSource(ctx, slug))
    .filter((kind): kind is TelephonyKind => (TELEPHONY_KINDS as readonly string[]).includes(kind));
  return [...new Set(kinds)];
}

export function phoneCallTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const kinds = telephonyInScope(ctx);
  return kinds.length > 0 ? [listTool(ctx, kinds), getTool(ctx, kinds)] : [];
}

const DAY = 86_400_000;

function listTool(ctx: RuntimeContext, kinds: TelephonyKind[]): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { toE164 } = await import('@/libs/phone');
        const number = args.number ? toE164(args.number) : null;
        if (args.number && !number) {
          return JSON.stringify({ ok: false, error: `${args.number} is not a phone number I can read; give it with its country code, e.g. +1 970 555 0100.` });
        }
        const since = new Date(Date.now() - (args.days ?? 7) * DAY);
        const limit = args.limit ?? 20;
        const out: Record<string, unknown>[] = [];
        const errors: string[] = [];
        if (kinds.includes('twilio-voice')) {
          const { listTwilioCalls, twilioCredentialsFor } = await import('@/libs/twilio/client');
          const creds = await twilioCredentialsFor(ctx.orgId);
          const listed = creds ? await listTwilioCalls(creds, { since, number, pageSize: Math.min(limit * (number ? 5 : 1), 200) }) : { ok: false as const, message: 'Twilio is not connected.' };
          if (listed.ok) {
            out.push(...listed.data.calls.map(c => ({ provider: 'twilio', id: c.sid, ...c })));
          } else {
            errors.push(listed.message);
          }
        }
        if (kinds.includes('vonage')) {
          const { listVonageCalls, vonageCredentialsFor } = await import('@/libs/vonage/client');
          const creds = await vonageCredentialsFor(ctx.orgId);
          const listed = creds ? await listVonageCalls(creds, { since }) : { ok: false as const, message: 'Vonage is not connected.' };
          if (listed.ok) {
            out.push(...listed.data.filter(c => !number || c.from === number || c.to === number).map(c => ({ provider: 'vonage', ...c })));
          } else {
            errors.push(listed.message);
          }
        }
        out.sort((a, b) => String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')));
        if (out.length === 0 && errors.length > 0) {
          return JSON.stringify({ ok: false, error: errors.join(' ') });
        }
        return JSON.stringify({ ok: true, since: since.toISOString(), calls: out.slice(0, limit), ...(errors.length > 0 ? { partial: errors } : {}), note: out.length === 0 ? `No calls${number ? ` with ${number}` : ''} since ${since.toISOString().slice(0, 10)}.` : 'Read one call whole, with its transcript, with phone_call and its id.' });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: PHONE_CALLS_TOOL,
      description: 'The workspace\'s recent phone calls, live from its connected phone account, newest first: from, to, direction, start time, duration in seconds, status. Narrow to one number and a number of days. Use it for "who called today", "did the Northwind buyer call back", before searching documents.',
      schema: z.object({
        number: z.string().optional().describe('Only calls to or from this number, with its country code.'),
        days: z.number().int().min(1).max(90).optional().describe('How many days back (default 7).'),
        limit: z.number().int().min(1).max(100).optional().describe('At most this many calls (default 20).'),
      }),
    },
  );
}

function getTool(ctx: RuntimeContext, kinds: TelephonyKind[]): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        if (/^CA[0-9a-f]{32}$/i.test(args.id)) {
          if (!kinds.includes('twilio-voice')) {
            return JSON.stringify({ ok: false, error: 'That is a Twilio call id, and this agent has no Twilio Voice source.' });
          }
          const { getTwilioCall, twilioCredentialsFor, twilioRecordingsFor } = await import('@/libs/twilio/client');
          const creds = await twilioCredentialsFor(ctx.orgId);
          if (!creds) {
            return JSON.stringify({ ok: false, error: 'Twilio is not connected.' });
          }
          const call = await getTwilioCall(creds, args.id);
          if (!call.ok) {
            return JSON.stringify({ ok: false, error: call.message });
          }
          const recordings = await twilioRecordingsFor(creds, args.id);
          return JSON.stringify({ ok: true, provider: 'twilio', call: call.data, recordings: recordings.ok ? recordings.data : [], ...(recordings.ok ? {} : { recordingsError: recordings.message }) });
        }
        if (!kinds.includes('vonage')) {
          return JSON.stringify({ ok: false, error: `${args.id} is not a call id I can read: a Twilio call id starts CA.` });
        }
        const { listVonageCalls, vonageCredentialsFor } = await import('@/libs/vonage/client');
        const creds = await vonageCredentialsFor(ctx.orgId);
        if (!creds) {
          return JSON.stringify({ ok: false, error: 'Vonage is not connected.' });
        }
        const listed = await listVonageCalls(creds, { since: new Date(Date.now() - 30 * DAY) });
        if (!listed.ok) {
          return JSON.stringify({ ok: false, error: listed.message });
        }
        const call = listed.data.find(c => c.id === args.id);
        return JSON.stringify(call ? { ok: true, provider: 'vonage', call, note: 'Vonage recordings need a Vonage Application, which this connection does not hold.' } : { ok: false, error: `No Vonage call ${args.id} in the last 30 days.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: PHONE_CALL_TOOL,
      description: 'One phone call, by the id phone_calls gave: who, when, how long, how it ended — and on Twilio its recordings with the words of any Twilio transcribed. Use it to quote what was said on a call.',
      schema: z.object({
        id: z.string().min(1).describe('The call id from phone_calls (Twilio: CA…).'),
      }),
    },
  );
}
