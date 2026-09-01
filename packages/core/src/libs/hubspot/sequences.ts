/**
 * HubSpot sequences — the library read behind the MQL drafting phase and the
 * enrollment write behind `personalization.enroll`.
 *
 * The sequences API (v 2026-03) is user-scoped: every call carries the
 * HubSpot `userId` whose sequence library it reads, resolved from a sender
 * email via the owners API. Enrollment carries ONLY sequenceId + contactId +
 * senderEmail — per-enrollment email customization does not ride the call,
 * which is why the approved personalized sends are staged on the contact as
 * a note for the sender (see `stageSendsAsNote`).
 *
 * Same error contract as the shared client: failures are data, not throws.
 */

import type { HubspotClient, HubspotResult } from './client';

const SEQUENCES_BASE = '/automation/sequences/2026-03';

export type HubspotSequence = {
  id: string;
  name: string;
  stepCount?: number;
  enrolledCount?: number;
};

export type SequenceEnrollment = {
  id?: string;
  sequenceId: string;
  contactId: string;
  senderEmail: string;
};

type RawSequence = {
  id?: string | number;
  name?: string;
  steps?: unknown[];
  numSteps?: number;
  enrolledCount?: number;
};

function toSequence(raw: RawSequence): HubspotSequence {
  return {
    id: String(raw.id ?? ''),
    name: raw.name ?? `sequence ${raw.id ?? ''}`,
    stepCount: Array.isArray(raw.steps) ? raw.steps.length : raw.numSteps,
    enrolledCount: raw.enrolledCount,
  };
}

/**
 * Resolve a HubSpot user id from a sender email via the owners API — the
 * sequences API is scoped to a user, and the workspace names people by email.
 * @param client
 * @param email
 */
export async function resolveHubspotUserId(
  client: HubspotClient,
  email: string,
): Promise<HubspotResult<{ userId: string; ownerId: string }>> {
  type OwnersBody = { results?: Array<{ id?: string | number; userId?: string | number; email?: string }> };
  const res = await client.get<OwnersBody>('/crm/v3/owners', { email });
  if (!res.ok) {
    return res;
  }
  const owner = (res.data.results ?? []).find(o => o.email?.toLowerCase() === email.toLowerCase())
    ?? res.data.results?.[0];
  if (!owner?.userId) {
    return { ok: false, error: 'hubspot_error', status: 404, message: `No HubSpot user found for ${email} — the sender must be a user of this portal.` };
  }
  return { ok: true, data: { userId: String(owner.userId), ownerId: String(owner.id ?? '') } };
}

/**
 * The user's existing sequences — the library the agent recommends FROM. It
 * never invents a sequence; a recommendation must name an id returned here.
 * @param client
 * @param userId
 */
export async function listSequences(
  client: HubspotClient,
  userId: string,
): Promise<HubspotResult<HubspotSequence[]>> {
  type SequencesBody = { total?: number; results?: RawSequence[] };
  const res = await client.get<SequencesBody>(SEQUENCES_BASE, { userId, limit: '100' });
  if (!res.ok) {
    return res;
  }
  return { ok: true, data: (res.data.results ?? []).map(toSequence) };
}

/**
 * One sequence by id — the existence check `save_draft_sequence` runs on the
 * recommendation before the review item is proposed.
 * @param client
 * @param sequenceId
 * @param userId
 */
export async function getSequence(
  client: HubspotClient,
  sequenceId: string,
  userId: string,
): Promise<HubspotResult<HubspotSequence>> {
  const res = await client.get<RawSequence>(`${SEQUENCES_BASE}/${sequenceId}`, { userId });
  if (!res.ok) {
    return res;
  }
  return { ok: true, data: toSequence(res.data) };
}

/**
 * Enroll a contact into an existing sequence as `senderEmail`. This is the
 * outbound write behind an approved Enroll — never called without one.
 * @param client
 * @param opts
 * @param opts.sequenceId
 * @param opts.contactId
 * @param opts.senderEmail
 * @param opts.userId - Scopes the call to the sender's sequence library.
 */
export async function enrollContact(
  client: HubspotClient,
  opts: { sequenceId: string; contactId: string; senderEmail: string; userId?: string },
): Promise<HubspotResult<SequenceEnrollment>> {
  const qs = opts.userId ? `?userId=${encodeURIComponent(opts.userId)}` : '';
  const res = await client.post<{ id?: string | number }>(`${SEQUENCES_BASE}/enrollments${qs}`, {
    sequenceId: opts.sequenceId,
    contactId: opts.contactId,
    senderEmail: opts.senderEmail,
  });
  if (!res.ok) {
    return res;
  }
  return {
    ok: true,
    data: {
      id: res.data.id === undefined ? undefined : String(res.data.id),
      sequenceId: opts.sequenceId,
      contactId: opts.contactId,
      senderEmail: opts.senderEmail,
    },
  };
}

/**
 * Stage the approved personalized sends on the contact as a timeline note.
 * The sequences API cannot carry per-enrollment copy, so the reviewed sends
 * travel to the sender this way — in HubSpot, on the record they belong to.
 * @param client
 * @param contactId
 * @param body - The note body (the approved sends, formatted).
 */
export async function stageSendsAsNote(
  client: HubspotClient,
  contactId: string,
  body: string,
): Promise<HubspotResult<{ noteId: string | null }>> {
  const res = await client.post<{ id?: string | number }>('/crm/v3/objects/notes', {
    properties: {
      hs_note_body: body.slice(0, 65_000),
      hs_timestamp: new Date().toISOString(),
    },
    associations: [{
      to: { id: contactId },
      // 202 = note → contact (HubSpot-defined association type).
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
    }],
  });
  if (!res.ok) {
    return res;
  }
  return { ok: true, data: { noteId: res.data.id === undefined ? null : String(res.data.id) } };
}
