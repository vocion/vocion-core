import type { NextResponse } from 'next/server';
import type { ApiCaller } from '@/services/writeApi';
import { jsonError } from '../_shared';

/** The longest actor a write may name: an id with a namespace, never prose. */
const ACTOR_MAX = 200;

/**
 * Who a learning decision is recorded against.
 *
 * A tenant token usually acts for a person in another system — a client's
 * admin panel adopting or retiring a rule — and the record should name that
 * person, not the token. So a token may name them in `field`. A dashboard
 * session IS the person, and naming someone else from it would put a decision
 * on another person's record, so it is refused. With no name given, the caller
 * itself is recorded, as every learning decision was before.
 * @param body - The parsed request body.
 * @param field - The body field that names the actor, e.g. `undoneBy`.
 * @param caller - The authenticated caller.
 */
export function readActorOverride(body: Record<string, unknown>, field: string, caller: ApiCaller): string | NextResponse {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return caller.actorId;
  }
  if (caller.source !== 'token') {
    return jsonError('VALIDATION_FAILED', `${field} may only be set by a tenant token`, 400);
  }
  const actor = typeof raw === 'string' ? raw.trim() : '';
  if (actor.length < 1 || actor.length > ACTOR_MAX) {
    return jsonError('VALIDATION_FAILED', `${field} must be 1–${ACTOR_MAX} characters`, 400);
  }
  return actor;
}

/**
 * An optional free-text field with a length cap, trimmed. Blank reads as not
 * given, so a client sending an empty box gets the default rather than an
 * empty string stored as if someone had written it.
 * @param body - The parsed request body.
 * @param field - The body field to read.
 * @param max - The most characters allowed, counted after trimming.
 */
export function readBoundedText(body: Record<string, unknown>, field: string, max: number): string | undefined | NextResponse {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return jsonError('VALIDATION_FAILED', `${field} must be a string`, 400);
  }
  const text = raw.trim();
  if (!text) {
    return undefined;
  }
  if (text.length > max) {
    return jsonError('VALIDATION_FAILED', `${field} must be at most ${max} characters`, 400);
  }
  return text;
}
