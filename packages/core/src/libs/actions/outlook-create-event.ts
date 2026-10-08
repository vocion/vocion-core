/**
 * outlook.create_event — put an event on the connected Outlook calendar
 * (Microsoft 365), as the person whose Microsoft login the workspace holds
 * (`Calendars.ReadWrite`, delegated). With attendees, Outlook sends each of
 * them an invitation, as it does when a person creates the meeting; with
 * `teamsMeeting`, the event carries a Teams join link.
 *
 * REVERSIBLE: Undo deletes the event, and Outlook sends the attendees a
 * cancellation. `external: true` puts it on the ladder at `medium`
 * (`DEFAULT_RISK_TIER`), so an agent's proposal waits for a person until a
 * workspace's trust.yaml says otherwise.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

const outlookCreateEventInput = z.object({
  subject: z.string().min(1).max(255),
  /** Start: ISO 8601. With an offset or `Z` it is an instant; without one it is read in `timeZone`. */
  start: z.string().min(10),
  /** End, in the same form as `start`. */
  end: z.string().min(10),
  /** An IANA or Windows time zone for a `start`/`end` written without an offset. Default UTC. */
  timeZone: z.string().min(1).optional(),
  /** Attendees' email addresses. Each receives an invitation. */
  attendees: z.array(z.string().email()).max(50).optional(),
  location: z.string().max(255).optional(),
  /** The invitation's description, plain text. */
  body: z.string().max(20_000).optional(),
  /** Give the event a Microsoft Teams join link. */
  teamsMeeting: z.boolean().optional(),
});

type Input = z.infer<typeof outlookCreateEventInput>;

/**
 * A time as Graph's `dateTimeTimeZone`: an instant (with `Z` or an offset)
 * becomes UTC; a wall-clock time keeps the zone the input named.
 * @param value - The input's `start` or `end`.
 * @param timeZone - The input's `timeZone`.
 */
export function graphDateTime(value: string, timeZone: string | undefined): { dateTime: string; timeZone: string } {
  const trimmed = value.trim();
  const hasOffset = /(?:Z|[+-]\d\d:?\d\d)$/i.test(trimmed);
  if (hasOffset) {
    const at = new Date(trimmed);
    if (Number.isNaN(at.getTime())) {
      throw new TypeError(`"${value}" is not a date and time Outlook can read.`);
    }
    return { dateTime: at.toISOString().slice(0, 19), timeZone: 'UTC' };
  }
  return { dateTime: trimmed, timeZone: timeZone ?? 'UTC' };
}

/**
 * The event Graph is asked to create.
 * @param input - The action input.
 */
export function eventBody(input: Input): Record<string, unknown> {
  return {
    subject: input.subject,
    start: graphDateTime(input.start, input.timeZone),
    end: graphDateTime(input.end, input.timeZone),
    ...(input.location ? { location: { displayName: input.location } } : {}),
    ...(input.body ? { body: { contentType: 'text', content: input.body } } : {}),
    ...(input.attendees?.length ? { attendees: input.attendees.map(address => ({ emailAddress: { address }, type: 'required' })) } : {}),
    ...(input.teamsMeeting ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
  };
}

export const OUTLOOK_CREATE_EVENT_ACTION_ID = 'outlook.create_event';

export const outlookCreateEventAction: Action<typeof outlookCreateEventInput> = {
  id: OUTLOOK_CREATE_EVENT_ACTION_ID,
  name: 'Add an Outlook calendar event',
  description: 'Create an event on the connected Outlook calendar (Microsoft 365). `start`/`end` are ISO 8601 (with an offset, or wall-clock in `timeZone`). Attendees get an invitation; `teamsMeeting: true` adds a Teams join link. Undo deletes the event and sends attendees a cancellation.',
  inputSchema: outlookCreateEventInput,
  grant: 'manage_calendar',
  external: true,
  sourceSlug: 'outlook-calendar',
  // One PENDING card per meeting: same subject at the same start.
  dedupKeyFor: input => `${OUTLOOK_CREATE_EVENT_ACTION_ID}:${input.subject.trim().toLowerCase()}:${input.start.trim()}`,
  async precheck(ctx, input) {
    try {
      const start = graphDateTime(input.start, input.timeZone);
      const end = graphDateTime(input.end, input.timeZone);
      if (start.timeZone === end.timeZone && end.dateTime <= start.dateTime) {
        return 'The event ends before it starts. Give an end after the start.';
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'The start or end could not be read.';
    }
    const { graphTokenForConnector } = await import('@/services/agents/tools/microsoft365');
    const got = await graphTokenForConnector(ctx.orgId, ['outlook-calendar']);
    return got.ok ? undefined : got.error;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const who = input.attendees?.length ? ` and invites ${input.attendees.length} ${input.attendees.length === 1 ? 'person' : 'people'}` : '';
    const headline = `Approving adds "${input.subject}" to the connected Outlook calendar${who}. Undo deletes it${input.attendees?.length ? ' and sends a cancellation' : ''}.`;
    return {
      title: `Outlook event — ${input.subject}`,
      system: 'Outlook Calendar',
      headline,
      badges: [{ label: 'Outlook Calendar' }, { label: 'Reversible' }],
      ...(input.body ? { contentHeading: { label: 'Invitation' }, content: [{ kind: 'message' as const, id: 'body', label: 'Description', body: input.body }] } : {}),
      fields: [
        { label: 'Starts', value: `${input.start}${input.timeZone ? ` (${input.timeZone})` : ''}` },
        { label: 'Ends', value: `${input.end}${input.timeZone ? ` (${input.timeZone})` : ''}` },
        ...(input.location ? [{ label: 'Where', value: input.location }] : []),
        ...(input.teamsMeeting ? [{ label: 'Online', value: 'Teams meeting link' }] : []),
        ...(input.attendees?.length ? [{ label: 'Invites', value: input.attendees.join(', ') }] : []),
      ],
      nextAction: headline,
      verbs: { approve: 'Approve & add', reject: 'Decline' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'body');
    if (!edit || edit.body === undefined) {
      return input;
    }
    return { ...input, body: edit.body };
  },
  async execute(ctx, input) {
    const [{ graphTokenForConnector }, { graphJson }] = await Promise.all([
      import('@/services/agents/tools/microsoft365'),
      import('@/libs/microsoft/graph'),
    ]);
    const got = await graphTokenForConnector(ctx.orgId, ['outlook-calendar']);
    if (!got.ok) {
      throw new Error(got.error);
    }
    const created = await graphJson<{ id?: string; webLink?: string; onlineMeeting?: { joinUrl?: string } | null }>(got.token, {
      path: '/me/events',
      method: 'POST',
      what: 'a new Outlook calendar event',
      body: eventBody(input),
    });
    if (!created.id) {
      throw new Error('Outlook did not return the new event\'s id, so it cannot be confirmed or undone. Check the calendar before trying again.');
    }
    return {
      created: true,
      eventId: created.id,
      webLink: created.webLink ?? null,
      joinUrl: created.onlineMeeting?.joinUrl ?? null,
      line: `Added "${input.subject}" to the Outlook calendar${input.attendees?.length ? ` and invited ${input.attendees.join(', ')}` : ''}.`,
    };
  },
  async undo(ctx, input, result) {
    const eventId = typeof result?.eventId === 'string' ? result.eventId : '';
    if (!eventId) {
      throw new Error('This run recorded no event, so there is nothing to take back.');
    }
    const [{ graphTokenForConnector }, { graphFetch, GraphError }] = await Promise.all([
      import('@/services/agents/tools/microsoft365'),
      import('@/libs/microsoft/graph'),
    ]);
    const got = await graphTokenForConnector(ctx.orgId, ['outlook-calendar']);
    if (!got.ok) {
      throw new Error(got.error);
    }
    try {
      await graphFetch(got.token, { path: `/me/events/${encodeURIComponent(eventId)}`, method: 'DELETE', what: 'the Outlook event' });
    } catch (error) {
      // Someone already deleted it in Outlook: what Undo was for has happened.
      if (error instanceof GraphError && error.status === 404) {
        return { deleted: true, eventId, line: `"${input.subject}" was already gone from the Outlook calendar.` };
      }
      throw error;
    }
    return { deleted: true, eventId, line: `Deleted "${input.subject}" from the Outlook calendar${input.attendees?.length ? '; attendees get a cancellation' : ''}.` };
  },
};
