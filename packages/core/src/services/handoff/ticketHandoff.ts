/**
 * HAND A CONVERSATION TO A PERSON: open one Zendesk ticket for it, once.
 *
 * `zendesk.create_ticket` (libs/actions/zendesk-create-ticket.ts) calls this
 * when an end user taps the agent's "Create a ticket" card. The rules:
 *
 * - ONE OPEN TICKET PER CONVERSATION. A conversation has at most one open
 *   `ticket_handoff` row. A tap while its ticket is still unsolved (new, open,
 *   pending, hold) gets that ticket back. Once it is solved or closed, or
 *   Zendesk answers 404 for it, the row is closed and the tap opens a new one.
 *   Taps for the same conversation take turns under an advisory lock, and the
 *   unique index backs the lock up.
 *
 * - A RETRY CAN ONLY GET THE SAME TICKET. The exact create body is stored on
 *   the row before it is first sent, with a fresh Idempotency-Key. A retry
 *   sends those same bytes with that same key, so inside Zendesk's two-hour
 *   window it gets the first ticket back. Before every create the ticket is
 *   also looked up by the external id the body puts on it, which covers a
 *   retry after the window has passed.
 *
 * - WHAT IS RETRYABLE. A timeout, a 5xx or a 429 leaves the row open with its
 *   body, so the next tap replays it. Zendesk refusing the create outright
 *   (another 4xx) closes the row, because sending the same body again would be
 *   refused again, and the next tap builds a fresh one.
 *
 * - THE REQUESTER IS THE CALLER. The ticket is filed for the end user who
 *   tapped (`requesterIdFor`), never anyone the model named. Subject prefix and
 *   tags come from the source's `tickets` settings, never the model.
 */
import type { ActionCaller } from '@/libs/actions/types';
import type { ZendeskCredentials, ZendeskDeps } from '@/libs/zendesk/client';
import type { TicketSummary } from '@/libs/zendesk/tickets';
import type { ZendeskTicketSettings } from '@/libs/zendesk/ticketSettings';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withAdvisoryLock } from '@/libs/advisoryLock';
import { db } from '@/libs/DB';
import { ZendeskError } from '@/libs/zendesk/client';
import { createTicket, requesterIdFor, ticketByExternalId, ticketStatus, UNSOLVED_TICKET_STATUSES } from '@/libs/zendesk/tickets';
import { ticketSubjectFor, ticketTagsFor } from '@/libs/zendesk/ticketSettings';
import { knowledgeSourceSchema, ticketHandoffSchema } from '@/models/Schema';

/** How many times a tap waits for another hand-off on the same conversation, and how long each wait is. */
const HANDOFF_LOCK_WAIT_ATTEMPTS = 50;
const HANDOFF_LOCK_WAIT_MS = 200;

/** What the agent wrote on the card, already checked by the action's schema. */
export type TicketRequest = { subject: string; summary: string; topic: string };

export type TicketHandoffInput = {
  orgId: string;
  conversationId: number;
  /** The zendesk source's slug. */
  sourceSlug: string;
  caller: ActionCaller;
  ticket: TicketRequest;
  credentials: ZendeskCredentials;
  settings: ZendeskTicketSettings;
  /** Where the end user opens their request, like `https://help.example.com/hc/en-us/requests/`. The ticket id is appended. */
  requestUrlBase: string;
  deps?: ZendeskDeps;
};

export type TicketHandoffResult = {
  ticketId: number;
  /** The page where the end user can follow their request. */
  requestUrl: string;
  /** True when this tap opened the ticket, false when it was already open. */
  created: boolean;
  handoffId: number;
};

export type TicketHandoffErrorCode
  /** Another tap on this conversation held the lock for the whole wait. Retryable. */
  = | 'HANDOFF_BUSY'
  /** Zendesk timed out, failed (5xx) or rate limited (429). Retryable: the next tap replays the stored body. */
    | 'ZENDESK_UNAVAILABLE'
  /** Zendesk refused a call outright. Not retryable as is. */
    | 'ZENDESK_REFUSED'
  /** The conversation's open hand-off was started by a different end user. */
    | 'CALLER_MISMATCH';

export class TicketHandoffError extends Error {
  readonly code: TicketHandoffErrorCode;
  readonly retryable: boolean;
  constructor(code: TicketHandoffErrorCode, message: string) {
    super(message);
    this.name = 'TicketHandoffError';
    this.code = code;
    this.retryable = code === 'HANDOFF_BUSY' || code === 'ZENDESK_UNAVAILABLE';
  }
}

type HandoffRow = typeof ticketHandoffSchema.$inferSelect;

/**
 * Open the conversation's ticket, or return the one already open.
 * @param input - Who tapped, what the agent wrote, and the Zendesk account.
 * @throws {TicketHandoffError} When nothing was opened; `retryable` says whether a later tap may succeed.
 */
export async function handOffToTicket(input: TicketHandoffInput): Promise<TicketHandoffResult> {
  const lockName = `ticket_handoff:${input.orgId}:${input.conversationId}`;
  for (let attempt = 0; attempt < HANDOFF_LOCK_WAIT_ATTEMPTS; attempt++) {
    const locked = await withAdvisoryLock(lockName, () => handOffUnderLock(input));
    if (locked.ran) {
      return locked.value;
    }
    await new Promise(resolve => setTimeout(resolve, HANDOFF_LOCK_WAIT_MS));
  }
  throw new TicketHandoffError('HANDOFF_BUSY', `Another hand-off for conversation ${input.conversationId} is still underway. Try again in a moment.`);
}

/**
 * The hand-off itself, with this conversation's lock held.
 * @param input - As {@link handOffToTicket}.
 */
async function handOffUnderLock(input: TicketHandoffInput): Promise<TicketHandoffResult> {
  const deps = input.deps ?? {};
  let row = await openHandoffFor(input.orgId, input.conversationId);
  if (row && row.ticketId !== null) {
    const openTicketId = row.ticketId;
    const status = await zendeskCall(row, false, () => ticketStatus(input.credentials, openTicketId, deps));
    if (status !== null && UNSOLVED_TICKET_STATUSES.has(status)) {
      refuseOtherCaller(row, input);
      await updateHandoff(row.id, { ticketStatus: status, lastError: null });
      return resultFor(row, openTicketId, input, false);
    }
    await updateHandoff(row.id, { status: 'closed', ticketStatus: status ?? 'not_found', closedAt: new Date() });
    row = null;
  }
  if (row) {
    refuseOtherCaller(row, input);
  }
  row ??= await startHandoff(input);
  const body = row.requestBody ?? await storeRequestBody(row, input, deps);
  const externalId = handoffExternalId(row);
  const idempotencyKey = row.idempotencyKey;
  const existing = await zendeskCall(row, false, () => ticketByExternalId(input.credentials, externalId, deps));
  const ticket: TicketSummary = existing ?? await zendeskCall(row, true, () => createTicket(input.credentials, body, idempotencyKey, deps));
  await updateHandoff(row.id, { ticketId: ticket.id, ticketStatus: ticket.status, lastError: null });
  return resultFor(row, ticket.id, input, existing === null);
}

/**
 * Refuse a tap from a different end user than the one whose hand-off is open,
 * so nobody is handed someone else's ticket or files under someone else's name.
 * @param row - The open hand-off row.
 * @param input - The tap.
 * @throws {TicketHandoffError} CALLER_MISMATCH.
 */
function refuseOtherCaller(row: HandoffRow, input: TicketHandoffInput): void {
  if (row.callerId !== input.caller.id) {
    throw new TicketHandoffError('CALLER_MISMATCH', `Conversation ${input.conversationId} already has a hand-off for a different end user, so this tap did not open a ticket.`);
  }
}

/**
 * A source's saved config, read by slug, or undefined when the workspace has
 * no source with that slug.
 * @param orgId - The workspace.
 * @param slug - The source slug.
 */
export async function sourceConfigFor(orgId: string, slug: string): Promise<unknown> {
  const [row] = await db.select({ configJson: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(
    eq(knowledgeSourceSchema.orgId, orgId),
    eq(knowledgeSourceSchema.slug, slug),
  )).limit(1);
  return row ? (row.configJson ?? {}) : undefined;
}

/**
 * The conversation's open hand-off row, or null.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function openHandoffFor(orgId: string, conversationId: number): Promise<HandoffRow | null> {
  const [row] = await db.select().from(ticketHandoffSchema).where(and(
    eq(ticketHandoffSchema.orgId, orgId),
    eq(ticketHandoffSchema.conversationId, conversationId),
    eq(ticketHandoffSchema.status, 'open'),
  )).limit(1);
  return row ?? null;
}

/**
 * The conversation a ticket was opened for, newest hand-off first, so a staff
 * reply on the ticket can find its way back. Null when no hand-off made it.
 * @param orgId - The workspace.
 * @param sourceSlug - The zendesk source's slug.
 * @param ticketId - The ticket.
 */
export async function conversationForTicket(orgId: string, sourceSlug: string, ticketId: number): Promise<number | null> {
  const [row] = await db.select({ conversationId: ticketHandoffSchema.conversationId }).from(ticketHandoffSchema).where(and(
    eq(ticketHandoffSchema.orgId, orgId),
    eq(ticketHandoffSchema.sourceSlug, sourceSlug),
    eq(ticketHandoffSchema.ticketId, ticketId),
  )).orderBy(sql`${ticketHandoffSchema.id} desc`).limit(1);
  return row?.conversationId ?? null;
}

/**
 * A new open row with a fresh Idempotency-Key and no body yet. If another
 * process opened one in between despite the lock, that row is used instead.
 * @param input - The hand-off.
 */
async function startHandoff(input: TicketHandoffInput): Promise<HandoffRow> {
  const [made] = await db.insert(ticketHandoffSchema).values({
    orgId: input.orgId,
    conversationId: input.conversationId,
    sourceSlug: input.sourceSlug,
    callerId: input.caller.id,
    idempotencyKey: randomUUID(),
  }).onConflictDoNothing().returning();
  if (made) {
    return made;
  }
  const winner = await openHandoffFor(input.orgId, input.conversationId);
  if (!winner) {
    throw new Error(`ticket_handoff: could not open or read the hand-off row for conversation ${input.conversationId}.`);
  }
  return winner;
}

/**
 * Find the requester, build the create body, and store it on the row before
 * it is ever sent. From here on the body never changes, because Zendesk
 * refuses the same Idempotency-Key with a different body.
 * @param row - The open row, with no body yet.
 * @param input - The hand-off.
 * @param deps - Injected for tests.
 */
async function storeRequestBody(row: HandoffRow, input: TicketHandoffInput, deps: ZendeskDeps): Promise<string> {
  const requesterId = await zendeskCall(row, true, () => requesterIdFor(input.credentials, input.caller, deps));
  const body = JSON.stringify({
    ticket: {
      subject: ticketSubjectFor(input.settings, input.ticket.subject),
      comment: { body: input.ticket.summary.trim() },
      requester_id: requesterId,
      status: 'new',
      tags: ticketTagsFor(input.settings, input.ticket.topic),
      external_id: handoffExternalId(row),
    },
  });
  const [stored] = await db.update(ticketHandoffSchema)
    .set({ requestBody: body, updatedAt: new Date() })
    .where(and(eq(ticketHandoffSchema.id, row.id), isNull(ticketHandoffSchema.requestBody)))
    .returning({ requestBody: ticketHandoffSchema.requestBody });
  if (stored?.requestBody) {
    return stored.requestBody;
  }
  // Another process stored one first: send that one, never a second body.
  const [current] = await db.select({ requestBody: ticketHandoffSchema.requestBody }).from(ticketHandoffSchema).where(eq(ticketHandoffSchema.id, row.id));
  if (!current?.requestBody) {
    throw new Error(`ticket_handoff ${row.id}: the request body was neither stored nor readable.`);
  }
  return current.requestBody;
}

/**
 * The external id the ticket carries, from the row's Idempotency-Key rather
 * than its row id, so two Vocion deployments writing to one Zendesk account
 * (a test workspace and a live one, say) can't find each other's tickets.
 * @param row - The hand-off row.
 */
export function handoffExternalId(row: Pick<HandoffRow, 'idempotencyKey'>): string {
  return `vocion-handoff-${row.idempotencyKey}`;
}

/**
 * Run one Zendesk call for this row. A failure is written on the row and
 * turned into a TicketHandoffError. A timeout, 5xx or 429 is retryable and
 * leaves the row open, so the next tap replays the stored body.
 *
 * Any other refusal is not retryable. It closes the row only when
 * `closeOnRefusal` says Zendesk's refusal proves no ticket exists for it: the
 * requester lookup (no body was stored yet) and the create itself (a 4xx
 * creates nothing). A refused read keeps the row open, because an earlier
 * create may have gone through, and a fresh row would open a second ticket.
 * @param row - The hand-off row.
 * @param closeOnRefusal - Whether a refusal may close the row.
 * @param call - The call.
 */
async function zendeskCall<T>(row: HandoffRow, closeOnRefusal: boolean, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ZendeskError)) {
      throw error;
    }
    const retryable = error.status === null || error.status === 429 || error.status >= 500;
    if (retryable) {
      await updateHandoff(row.id, { lastError: error.message });
      throw new TicketHandoffError('ZENDESK_UNAVAILABLE', `Zendesk could not be reached or was busy, so no ticket was opened yet: ${error.message}`);
    }
    await updateHandoff(row.id, closeOnRefusal ? { status: 'closed', lastError: error.message, closedAt: new Date() } : { lastError: error.message });
    throw new TicketHandoffError('ZENDESK_REFUSED', `Zendesk refused the hand-off: ${error.message}`);
  }
}

/**
 * Write fields on a hand-off row and stamp `updated_at`.
 * @param id - The row.
 * @param patch - The fields.
 */
async function updateHandoff(id: number, patch: Partial<Pick<HandoffRow, 'status' | 'ticketId' | 'ticketStatus' | 'lastError' | 'closedAt'>>): Promise<void> {
  await db.update(ticketHandoffSchema).set({ ...patch, updatedAt: new Date() }).where(eq(ticketHandoffSchema.id, id));
}

/**
 * What the action hands back.
 * @param row - The hand-off row.
 * @param ticketId - The ticket.
 * @param input - The hand-off, for the request page.
 * @param created - Whether this tap opened it.
 */
function resultFor(row: HandoffRow, ticketId: number, input: TicketHandoffInput, created: boolean): TicketHandoffResult {
  return { ticketId, requestUrl: `${input.requestUrlBase}${ticketId}`, created, handoffId: row.id };
}
