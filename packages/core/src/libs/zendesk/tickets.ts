/**
 * The Zendesk calls a hand-off makes: find or make the end user's Zendesk
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
 * The only Zendesk role a hand-off files a ticket for. Zendesk's roles are
 * "end-user", "agent" and "admin", and a light or custom-role agent still has
 * role "agent" (developer.zendesk.com/api-reference/ticketing/users/users/,
 * JSON format: `role`, `role_type`, `custom_role_id`).
 */
export const REQUESTER_ROLE = 'end-user';

/** A Zendesk user, as much of it as the requester lookup reads. */
type UserSummary = {
  id: number;
  /** Empty when Zendesk left it out, which never counts as an end user. */
  role: string;
  /**
   * The `email` Zendesk answers with, or null when it has none. That is "the
   * user's email address selected for notifications", which "can differ from
   * the primary email address if the primary email is unverified or
   * undeliverable" (developer.zendesk.com/api-reference/ticketing/users/users/, JSON format).
   */
  email: string | null;
};

/**
 * The caller matched a Zendesk agent or admin, so the hand-off stops: filing
 * the ticket for that person would put a staff account down as the golfer, and
 * nothing here may change a staff account to make it fit. Nobody is changed and
 * nothing is created. Not retryable, because the next tap matches the same user.
 */
export class RequesterNotEndUserError extends Error {
  /** The Zendesk user that matched, so support can look into it. */
  readonly zendeskUserId: number;
  constructor(zendeskUserId: number, matchedBy: string) {
    super(`The caller matched Zendesk user ${zendeskUserId} by ${matchedBy}, and that user is not an end user, so no ticket is filed for them.`);
    this.name = 'RequesterNotEndUserError';
    this.zendeskUserId = zendeskUserId;
  }
}

/**
 * How many pages of an email search are read, at 100 users a page. The
 * `email:` keyword matches users whose email starts with the value, so one
 * page holds every match unless 100 or more users' emails start with the
 * caller's; the cap only keeps a strange answer from looping. Past it the
 * lookup falls through to the create, which never changes an existing user
 * (see `requesterIdFor`).
 */
export const EMAIL_SEARCH_MAX_PAGES = 10;

/**
 * The users in a users answer. A user without a numeric id is a malformed
 * answer; a missing role or email reads as empty, which never passes the
 * end-user check or the exact email match.
 * @param answer - Zendesk's answer to a users search.
 * @param lookup - Which lookup it answered, for the error. Never the URL,
 *   which carries the caller's email into the hand-off's `last_error`.
 */
function usersOf(answer: Record<string, unknown>, lookup: string): UserSummary[] {
  const users = Array.isArray(answer.users) ? answer.users : [];
  return users.map((entry) => {
    const user = entry as { id?: unknown; role?: unknown; email?: unknown } | null;
    if (typeof user?.id !== 'number') {
      throw new ZendeskError(`Zendesk answered the ${lookup} with a user that has no id.`, null);
    }
    return {
      id: user.id,
      role: typeof user.role === 'string' ? user.role : '',
      email: typeof user.email === 'string' ? user.email : null,
    };
  });
}

/**
 * The requester among the users a lookup matched, or null when it matched
 * none. Every match must be an end user: one agent or admin among them stops
 * the hand-off, rather than quietly picking someone else. When several end
 * users match, the lowest id (the first made) wins, so every tap picks the same one.
 * @param users - The users the lookup matched.
 * @param matchedBy - How they matched, for the error.
 * @throws {RequesterNotEndUserError} When any match is not an end user.
 */
function requesterAmong(users: UserSummary[], matchedBy: string): number | null {
  const staff = users.find(user => user.role !== REQUESTER_ROLE);
  if (staff) {
    throw new RequesterNotEndUserError(staff.id, matchedBy);
  }
  if (users.length === 0) {
    return null;
  }
  return users.reduce((first, user) => (user.id < first.id ? user : first)).id;
}

/**
 * The users whose external id is this one. Zendesk's `external_id` search
 * parameter "only accepts ids", not search syntax (Search Users), and the API
 * treats external ids as case-insensitive (JSON format, `external_id`), both on
 * developer.zendesk.com/api-reference/ticketing/users/users/.
 * @param credentials - The client.
 * @param externalId - The external id to look up.
 * @param deps - Injected for tests.
 */
async function usersByExternalId(credentials: ZendeskCredentials, externalId: string, deps: ZendeskDeps): Promise<UserSummary[]> {
  const path = `/api/v2/users/search?external_id=${encodeURIComponent(externalId)}`;
  const answer = await zendeskRequest(credentials, { path, scopes: HANDOFF_SCOPES }, deps);
  return usersOf(answer, 'external id lookup');
}

/**
 * The users whose answered `email` (see `UserSummary.email`) is exactly this
 * one, ignoring case. The search's `email:` keyword is not an exact match: it
 * "may return any user whose email starts with" the value
 * (support.zendesk.com/hc/en-us/articles/4408886879258, user keywords), so
 * `pat@example.com` can also bring back `pat@example.com.au`, and only an
 * exact email counts here. A user whose answered email is another of their
 * addresses is not matched, and the lookup goes on to the create.
 *
 * Paging: Search Users "returns up to 100 records per page" with offset
 * pagination (Search Users, users page above), but its example answer shows no
 * paging field. The Search API's answers carry a `next_page` URL, null on the
 * last page (developer.zendesk.com/api-reference/ticketing/ticket-management/search/),
 * so pages are read while the answer has a `next_page` string, up to
 * `EMAIL_SEARCH_MAX_PAGES`; an answer without one stops after its page.
 * @param credentials - The client.
 * @param email - The caller's email.
 * @param deps - Injected for tests.
 */
async function usersByEmail(credentials: ZendeskCredentials, email: string, deps: ZendeskDeps): Promise<UserSummary[]> {
  const query = encodeURIComponent(`email:${email}`);
  const wanted = email.toLowerCase();
  const matches: UserSummary[] = [];
  for (let page = 1; page <= EMAIL_SEARCH_MAX_PAGES; page++) {
    const answer = await zendeskRequest(credentials, { path: `/api/v2/users/search?query=${query}&per_page=100&page=${page}`, scopes: HANDOFF_SCOPES }, deps);
    matches.push(...usersOf(answer, 'email lookup').filter(user => user.email?.toLowerCase() === wanted));
    if (typeof answer.next_page !== 'string') {
      break;
    }
  }
  return matches;
}

/**
 * The Zendesk user a ticket is filed for: always the end user who tapped the
 * card, never anyone the model named, and never an agent or admin. Looked up
 * in this order, stopping at the first step that matches anyone:
 *   1. a user whose external id is the caller's id;
 *   2. a user whose external id is the caller's email, which an earlier tool
 *      may have used;
 *   3. a user whose email is the caller's email, such as a golfer who
 *      emailed support before;
 *   4. otherwise a new end user, made with POST /api/v2/users from the
 *      caller's name, email and id.
 *
 * WHY no step changes an existing user. The old step 2 moved the email-keyed
 * user's external id over, and step 4 was create_or_update, which "updates an
 * existing user identified by e-mail address or external ID" (Create Or Update
 * User, same page). Either one could rewrite an agent's or admin's account
 * when a caller's email or id collided with it. Now a match is only ever read,
 * and a match that is not an end user stops the hand-off.
 *
 * Repeating it never changes anyone, because steps 1 to 3 only read and step 4
 * only creates. It can send the create twice, though: Zendesk's search can
 * take a few minutes to show a new user (developer.zendesk.com/api-reference/ticketing/ticket-management/search/),
 * so a repeat soon after a create that timed out may not find that user.
 * Zendesk's docs don't say how it answers a create whose email is already on
 * a user; the same goes for an email the lookups can't see, such as a
 * secondary email on a merged user. A refusal (a 4xx) stops the hand-off as a
 * non-retryable ZENDESK_REFUSED and closes the row, so the next tap starts a
 * fresh one, which finds the user once search shows it. An accepted create
 * leaves the account with two end users for that email.
 *
 * The caller's id and email are never blank here: the only caller is a card
 * tap, whose caller `CardCallerSchema` (`libs/actions/cardRunnable.ts`) trims
 * and requires, with a valid email.
 * @param credentials - The client.
 * @param caller - The end user who tapped the card.
 * @param deps - Injected for tests.
 * @throws {RequesterNotEndUserError} When a step matches an agent or admin.
 */
export async function requesterIdFor(credentials: ZendeskCredentials, caller: ActionCaller, deps: ZendeskDeps = {}): Promise<number> {
  const byId = requesterAmong(await usersByExternalId(credentials, caller.id, deps), 'external id');
  if (byId !== null) {
    return byId;
  }
  const byEmailKey = requesterAmong(await usersByExternalId(credentials, caller.email, deps), 'an external id equal to their email');
  if (byEmailKey !== null) {
    return byEmailKey;
  }
  const byEmail = requesterAmong(await usersByEmail(credentials, caller.email, deps), 'email');
  if (byEmail !== null) {
    return byEmail;
  }
  const made = await zendeskRequest(credentials, {
    path: '/api/v2/users',
    scopes: HANDOFF_SCOPES,
    method: 'POST',
    body: JSON.stringify({ user: { name: caller.name, email: caller.email, external_id: caller.id, role: REQUESTER_ROLE } }),
  }, deps);
  const id = (made.user as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'number') {
    throw new ZendeskError('Zendesk answered POST /api/v2/users without a user id, so there is no requester to file the ticket for.', null);
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
