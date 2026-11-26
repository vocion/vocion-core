/**
 * The Zendesk calls a hand-off makes: find or fix the end user's Zendesk
 * user, read a ticket's status, find a ticket by its external id, and create
 * one. Every call goes through `zendeskRequest`, so each gets the cached OAuth
 * token, one retry on a 401, and nothing else retried: whether a write may be
 * sent again is the hand-off's call (`services/handoff/ticketHandoff.ts`),
 * because only it knows the stored body and its Idempotency-Key.
 *
 * Endpoints and their behavior: developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 * and developer.zendesk.com/api-reference/ticketing/users/users/.
 */
import type { ZendeskCredentials, ZendeskDeps, ZendeskScope } from './client';
import type { ActionCaller } from '@/libs/actions/types';
import { ZendeskError, zendeskRequest } from './client';

/** One scope set for every hand-off call, so they share one cached token. */
export const HANDOFF_SCOPES: readonly ZendeskScope[] = ['tickets:read', 'tickets:write', 'users:read', 'users:write'];

/** Ticket statuses that mean a person still has it, so the next tap gets this ticket back. */
export const UNSOLVED_TICKET_STATUSES: ReadonlySet<string> = new Set(['new', 'open', 'pending', 'hold']);

/** A ticket, as much of it as a hand-off reads. */
export type TicketSummary = { id: number; status: string };

/**
 * The first user in a users list answer, or null when the list is empty.
 * @param answer - Zendesk's answer to a users search.
 */
function firstUserId(answer: Record<string, unknown>): number | null {
  const users = Array.isArray(answer.users) ? answer.users : [];
  const id = (users[0] as { id?: unknown } | undefined)?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * The users whose external id is exactly this one. Zendesk's `external_id`
 * parameter takes the id itself, not search syntax.
 * @param credentials - The client.
 * @param externalId - The external id to look up.
 * @param deps - Injected for tests.
 */
async function userIdByExternalId(credentials: ZendeskCredentials, externalId: string, deps: ZendeskDeps): Promise<number | null> {
  const answer = await zendeskRequest(credentials, {
    path: `/api/v2/users/search?external_id=${encodeURIComponent(externalId)}`,
    scopes: HANDOFF_SCOPES,
  }, deps);
  return firstUserId(answer);
}

/**
 * The Zendesk user a ticket is filed for: always the end user who tapped the
 * card, never anyone the model named. Looked up in this order:
 *   1. a user whose external id is the caller's id;
 *   2. a user whose external id is the caller's email, which an earlier tool
 *      may have used, moved over to the caller's id so step 1 finds it next
 *      time instead of a second user being made;
 *   3. otherwise create_or_update with the caller's name, email and id.
 * Each step is safe to repeat, so a retry after a failure here never makes a
 * second user.
 * @param credentials - The client.
 * @param caller - The end user who tapped the card.
 * @param deps - Injected for tests.
 */
export async function requesterIdFor(credentials: ZendeskCredentials, caller: ActionCaller, deps: ZendeskDeps = {}): Promise<number> {
  const byId = await userIdByExternalId(credentials, caller.id, deps);
  if (byId !== null) {
    return byId;
  }
  const byEmail = await userIdByExternalId(credentials, caller.email, deps);
  if (byEmail !== null) {
    await zendeskRequest(credentials, {
      path: `/api/v2/users/${byEmail}`,
      scopes: HANDOFF_SCOPES,
      method: 'PUT',
      body: JSON.stringify({ user: { external_id: caller.id } }),
    }, deps);
    return byEmail;
  }
  const made = await zendeskRequest(credentials, {
    path: '/api/v2/users/create_or_update',
    scopes: HANDOFF_SCOPES,
    method: 'POST',
    body: JSON.stringify({ user: { name: caller.name, email: caller.email, external_id: caller.id } }),
  }, deps);
  const id = (made.user as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'number') {
    throw new ZendeskError('Zendesk answered create_or_update without a user id, so there is no requester to file the ticket for.', null);
  }
  return id;
}

/**
 * The ticket's id and status from a ticket answer.
 * @param answer - The `ticket` object Zendesk answered with.
 * @param call - The call, for the error.
 */
function ticketSummaryOf(answer: unknown, call: string): TicketSummary {
  const ticket = answer as { id?: unknown; status?: unknown } | undefined;
  if (typeof ticket?.id !== 'number' || typeof ticket.status !== 'string') {
    throw new ZendeskError(`Zendesk answered ${call} without a ticket id and status.`, null);
  }
  return { id: ticket.id, status: ticket.status };
}

/**
 * A ticket's current status, or null when Zendesk answers 404 for it, which
 * a hand-off treats like a solved ticket: the next tap opens a new one.
 * @param credentials - The client.
 * @param ticketId - The ticket.
 * @param deps - Injected for tests.
 */
export async function ticketStatus(credentials: ZendeskCredentials, ticketId: number, deps: ZendeskDeps = {}): Promise<string | null> {
  try {
    const answer = await zendeskRequest(credentials, { path: `/api/v2/tickets/${ticketId}`, scopes: HANDOFF_SCOPES }, deps);
    return ticketSummaryOf(answer.ticket, `GET /api/v2/tickets/${ticketId}`).status;
  } catch (error) {
    if (error instanceof ZendeskError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * The ticket a hand-off already made, found by the external id it put on it,
 * or null when there is none. Zendesk does not keep external ids unique, so
 * when more than one answers, the lowest id (the first made) wins.
 * @param credentials - The client.
 * @param externalId - The hand-off's external id.
 * @param deps - Injected for tests.
 */
export async function ticketByExternalId(credentials: ZendeskCredentials, externalId: string, deps: ZendeskDeps = {}): Promise<TicketSummary | null> {
  const path = `/api/v2/tickets?external_id=${encodeURIComponent(externalId)}`;
  const call = `GET ${path}`;
  const answer = await zendeskRequest(credentials, { path, scopes: HANDOFF_SCOPES }, deps);
  const tickets = (Array.isArray(answer.tickets) ? answer.tickets : []).map(t => ticketSummaryOf(t, call));
  if (tickets.length === 0) {
    return null;
  }
  return tickets.reduce((first, t) => (t.id < first.id ? t : first));
}

/**
 * Create the ticket from the exact body the hand-off stored, with its
 * Idempotency-Key, so a repeat inside Zendesk's two-hour window gets the
 * same ticket back instead of a second one.
 * @param credentials - The client.
 * @param body - The stored request body, sent byte for byte.
 * @param idempotencyKey - The hand-off's key.
 * @param deps - Injected for tests.
 */
export async function createTicket(credentials: ZendeskCredentials, body: string, idempotencyKey: string, deps: ZendeskDeps = {}): Promise<TicketSummary> {
  const answer = await zendeskRequest(credentials, {
    path: '/api/v2/tickets',
    scopes: HANDOFF_SCOPES,
    method: 'POST',
    body,
    idempotencyKey,
  }, deps);
  return ticketSummaryOf(answer.ticket, 'POST /api/v2/tickets');
}
