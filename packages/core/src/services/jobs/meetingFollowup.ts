/**
 * MEETING FOLLOW-UP — a call with a client or prospect leaves a follow-up
 * owed, and this job carries it from the captured record to a draft waiting
 * in Review, with the person who owns the meeting told at each step.
 *
 * A call's record is private until a person releases it (the rule the
 * discovery lane keeps with its content gate). So the job has two phases, and
 * one review item between them does both jobs: it is the release AND the
 * start of the draft.
 *
 * TRIAGE — on `meeting.transcript_ready` (`services/meetings/captures.ts`):
 *   1. **Metadata first.** A capture that lists its attendees and lists nobody
 *      outside the owner's domain is an internal call: nothing is read.
 *   2. **One per meeting.** A meeting already carded — this capture or the
 *      other capture of the same call (owner + start, `meetingKey`) — is not
 *      carded again; a call whose discovery card a person already approved is
 *      followed up by that approval.
 *   3. **A model read, typed.** The classifier reads the title, the people and
 *      the opening of the record and returns who the other side was
 *      (`client`, `prospect`, `partner`, …) and whether a written follow-up is
 *      owed. Code routes on those two fields, never on the words.
 *   4. **The card.** `meeting.draft_followup` is filed — "Approve to draft the
 *      <meeting> follow-up" — with what only lookups can give: the data room
 *      the capture was filed in, the deck and document on it, and the next
 *      meeting already on the calendar with these people. A pending discovery
 *      card for the same call is closed in its favour. `meeting.followup_awaiting`
 *      tells the meeting's owner the card is waiting.
 *
 * DRAFT — on `meeting.followup_approved` (`input.phase: draft`), raised by the
 * card's approval:
 *   5. `meeting.followup_owed` is raised inline; the plugin's writer runs on it
 *      (a mission check whose `requireTool` is the `gmail.send` proposal),
 *      reading the released record with `read_meeting_record`.
 *   6. The proposals that run made are read off their envelope
 *      (`proposal.missionRunId`), and `meeting.followup_ready` is raised for
 *      each, so the owner hears the draft is in Review.
 *
 * Nothing fails silently: every outcome — internal, not owed, already
 * carded, drafted, drafted nothing — is the fire's result on the run log.
 */

import type { MeetingCapture } from '@/services/meetings/captures';
import { meetingKey } from '@/services/meetings/captures';

export { meetingKey };

export const MEETING_FOLLOWUP_JOB = 'meeting-followup';

/** Who the people outside were, as the classifier may answer. */
export const COUNTERPARTS = ['client', 'prospect', 'partner', 'vendor', 'candidate', 'internal', 'personal', 'other'] as const;
export type Counterpart = typeof COUNTERPARTS[number];

/** The counterparts a follow-up is drafted for. */
export const FOLLOWED_UP: ReadonlySet<Counterpart> = new Set(['client', 'prospect']);

/** The classifier's typed read of one meeting. */
export type MeetingRead = { counterpart: Counterpart; followUpOwed: boolean; why: string };

/** What the drafter is handed beside the capture. */
export type MeetingContext = {
  room: { id: number; title: string } | null;
  deck: { id: number; title: string } | null;
  document: { id: number; title: string } | null;
  nextMeeting: { title: string; start: string } | null;
};

/** What is already decided or waiting for this meeting. */
export type MeetingHandled = {
  /** A follow-up card for this meeting, any status. */
  card: number | null;
  /** Discovery cards for the same call still waiting on a person. */
  discoveryPending: number[];
  /** A discovery card for the same call a person approved — that approval is the release; `missionRunId` is the run it started. */
  discoveryApproved: { runId: number; missionRunId: number | null; documentId: number | null } | null;
};

/** How much of the record the classifier reads. */
export const READ_CHARS = 12_000;

type Skip = 'no-document' | 'not-a-meeting' | 'internal' | 'not-owed' | 'already-carded' | 'discovery-approved' | 'already-drafted';

export type MeetingFollowupResult
  = | { outcome: 'skipped'; reason: Skip; detail: string; documentId?: number; read?: MeetingRead }
    | { outcome: 'awaiting'; documentId: number; read: MeetingRead; actionRunId: number; superseded: number[]; detail: string }
    | { outcome: 'drafted'; documentId: number; proposals: number[]; detail: string }
    | { outcome: 'no-draft'; documentId: number; detail: string };

/** The seams, so the routing is testable without a model or a database. */
export type MeetingFollowupDeps = {
  capture: (orgId: string, documentId: number) => Promise<MeetingCapture | null>;
  handled: (orgId: string, capture: MeetingCapture, key: string) => Promise<MeetingHandled>;
  text: (orgId: string, documentId: number) => Promise<string>;
  read: (orgId: string, facts: string) => Promise<MeetingRead | null>;
  context: (orgId: string, capture: MeetingCapture) => Promise<MeetingContext>;
  /** File the follow-up card; its run id. */
  file: (orgId: string, input: Record<string, unknown>, read: MeetingRead, agentSlug: string) => Promise<{ runId: number; outcome: string }>;
  /** Close pending discovery cards the follow-up card stands in for. */
  supersede: (orgId: string, runIds: number[], by: number) => Promise<void>;
  /** Raise an event inline; the mission runs its subscribers started, by id, and the fires it held back. */
  emit: (orgId: string, type: string, payload: Record<string, unknown>, dedupeKey: string) => Promise<{ deduped: boolean; runIds: number[]; skipped: Array<{ slug: string; reason: string }> }>;
  /** The `gmail.send` proposals these runs made. */
  drafts: (orgId: string, missionRunIds: number[]) => Promise<Array<{ id: number; to: string; subject: string; attachments: number }>>;
};

/**
 * The facts the classifier reads, as lines. Pure.
 * @param capture - The capture.
 * @param text - The opening of the record.
 */
export function meetingFacts(capture: MeetingCapture, text: string): string {
  return [
    `Meeting: ${capture.title ?? '(untitled)'}`,
    `When: ${capture.start ?? 'unknown'}`,
    `Owner (our side): ${capture.owner ?? 'unknown'}`,
    `Attendees: ${capture.attendees.length > 0 ? capture.attendees.join(', ') : 'not listed'}`,
    `Outside the owner's domain: ${capture.external.length > 0 ? capture.external.join(', ') : capture.attendees.length > 0 ? 'nobody' : 'unknown'}`,
    '',
    'The record (opening):',
    text.slice(0, READ_CHARS),
  ].join('\n');
}

/**
 * Whether the read says a follow-up is owed. Pure — the routing rule.
 * @param read - The classifier's read.
 */
export function followUpOwed(read: MeetingRead): boolean {
  return read.followUpOwed && FOLLOWED_UP.has(read.counterpart);
}

/**
 * The follow-up card's input (`meeting.draft_followup`): scalars only, so it
 * rides every event after it as a filterable payload. Pure.
 * @param capture - The capture.
 * @param read - The read.
 * @param ctx - The lookups.
 */
export function cardInput(capture: MeetingCapture, read: MeetingRead, ctx: MeetingContext): Record<string, string | number> {
  return {
    documentId: capture.documentId,
    externalId: capture.externalId,
    meetingKey: meetingKey(capture),
    title: capture.title ?? '',
    start: capture.start ?? '',
    owner: capture.owner ?? '',
    attendees: capture.attendees.join(', '),
    externalAttendees: capture.external.join(', '),
    counterpart: read.counterpart,
    why: read.why,
    roomId: ctx.room?.id ?? 0,
    roomTitle: ctx.room?.title ?? '',
    deckArtifactId: ctx.deck?.id ?? 0,
    deckTitle: ctx.deck?.title ?? '',
    documentArtifactId: ctx.document?.id ?? 0,
    documentTitle: ctx.document?.title ?? '',
    nextMeetingTitle: ctx.nextMeeting?.title ?? '',
    nextMeetingStart: ctx.nextMeeting?.start ?? '',
  };
}

/**
 * Run the job for one fire.
 * @param orgId - The workspace.
 * @param input - The event's payload merged over the automation's `do.input`:
 * `phase` (`triage`, the default, or `draft`) and `agent` (the seat the card
 * is filed for) come from the automation.
 * @param deps - The seams; production wiring by default.
 */
export async function runMeetingFollowupJob(orgId: string, input: Record<string, unknown>, deps: MeetingFollowupDeps = productionDeps()): Promise<MeetingFollowupResult> {
  return input.phase === 'draft' ? draftPhase(orgId, input, deps) : triagePhase(orgId, input, deps);
}

async function triagePhase(orgId: string, input: Record<string, unknown>, deps: MeetingFollowupDeps): Promise<MeetingFollowupResult> {
  const documentId = Number(input.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return { outcome: 'skipped', reason: 'no-document', detail: 'the fire named no captured document (documentId)' };
  }
  const capture = await deps.capture(orgId, documentId);
  if (!capture) {
    return { outcome: 'skipped', reason: 'not-a-meeting', documentId, detail: `document #${documentId} is not a meeting capture, or is gone` };
  }
  if (capture.attendees.length > 0 && capture.external.length === 0) {
    return { outcome: 'skipped', reason: 'internal', documentId, detail: `everyone on "${capture.title ?? 'the call'}" shares the owner's domain` };
  }
  const key = meetingKey(capture);
  const handled = await deps.handled(orgId, capture, key);
  if (handled.card !== null) {
    return { outcome: 'skipped', reason: 'already-carded', documentId, detail: `this meeting already has its follow-up card (#${handled.card})` };
  }
  const approved = handled.discoveryApproved;
  if (approved && approved.missionRunId !== null && (await deps.drafts(orgId, [approved.missionRunId])).length > 0) {
    return { outcome: 'skipped', reason: 'discovery-approved', documentId, detail: `this call's discovery card #${approved.runId} was approved and its run #${approved.missionRunId} drafted the follow-up` };
  }
  const read = await deps.read(orgId, meetingFacts(capture, await deps.text(orgId, documentId)));
  if (!read) {
    // An unread meeting is not a meeting judged to need nothing: the fire errors where a person sees it.
    throw new Error(`meeting-followup: the classifier could not read document #${documentId} ("${capture.title ?? 'untitled'}")`);
  }
  if (approved) {
    // THE PERSON ALREADY RELEASED THIS CALL (its discovery card, approved)
    // and nothing it started drafted the follow-up: draft now, without a
    // second card. Their word runs; the classifier's read only fills the why.
    const ctx = await deps.context(orgId, capture);
    const card = cardInput(capture, read, ctx);
    return draftPhase(orgId, { ...card, documentId: approved.documentId ?? documentId, approvalRunId: approved.runId }, deps);
  }
  if (!followUpOwed(read)) {
    return { outcome: 'skipped', reason: 'not-owed', documentId, read, detail: `${read.counterpart}, follow-up ${read.followUpOwed ? 'owed' : 'not owed'}: ${read.why}` };
  }
  const ctx = await deps.context(orgId, capture);
  const card = cardInput(capture, read, ctx);
  const filed = await deps.file(orgId, card, read, typeof input.agent === 'string' && input.agent ? input.agent : 'followup-writer');
  if (filed.outcome === 'already_decided') {
    return { outcome: 'skipped', reason: 'already-carded', documentId, read, detail: `a person already decided this meeting's follow-up card (#${filed.runId})` };
  }
  if (handled.discoveryPending.length > 0) {
    await deps.supersede(orgId, handled.discoveryPending, filed.runId);
  }
  const { MEETING_FOLLOWUP_AWAITING } = await import('@/services/eventNames');
  const { meetingName } = await import('@/libs/actions/meeting-followup');
  await deps.emit(orgId, MEETING_FOLLOWUP_AWAITING, {
    actionRunId: filed.runId,
    documentId,
    owner: capture.owner ?? '',
    meetingTitle: meetingName({ title: capture.title ?? '' }),
    externalAttendees: capture.external.join(', '),
    counterpart: read.counterpart,
    why: read.why,
    roomId: ctx.room?.id ?? 0,
    attaches: ctx.deck?.title || ctx.document?.title || '',
    link: `/dashboard/inbox/proposal-${filed.runId}`,
  }, `${MEETING_FOLLOWUP_AWAITING}:${filed.runId}`);
  return {
    outcome: 'awaiting',
    documentId,
    read,
    actionRunId: filed.runId,
    superseded: handled.discoveryPending,
    detail: `${read.counterpart} call, follow-up owed: card #${filed.runId} waits on its owner${handled.discoveryPending.length > 0 ? `; closed discovery card${handled.discoveryPending.length === 1 ? '' : 's'} ${handled.discoveryPending.map(id => `#${id}`).join(', ')} in its favour` : ''}`,
  };
}

async function draftPhase(orgId: string, input: Record<string, unknown>, deps: MeetingFollowupDeps): Promise<MeetingFollowupResult> {
  const documentId = Number(input.documentId);
  const approvalRunId = Number(input.approvalRunId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return { outcome: 'skipped', reason: 'no-document', detail: 'the approval named no captured document (documentId)' };
  }
  const { MEETING_FOLLOWUP_OWED, MEETING_FOLLOWUP_READY } = await import('@/services/eventNames');
  const { phase: _phase, agent: _agent, ...payload } = input;
  const owed = await deps.emit(orgId, MEETING_FOLLOWUP_OWED, payload, `${MEETING_FOLLOWUP_OWED}:${approvalRunId > 0 ? approvalRunId : String(input.meetingKey ?? documentId)}`);
  if (owed.deduped) {
    return { outcome: 'skipped', reason: 'already-drafted', documentId, detail: 'this approval already started its draft' };
  }
  const drafts = await deps.drafts(orgId, owed.runIds);
  if (drafts.length === 0) {
    return {
      outcome: 'no-draft',
      documentId,
      detail: owed.skipped.length > 0
        ? `the follow-up was approved, and its drafting did not run: ${owed.skipped.map(s => `${s.slug} (${s.reason})`).join('; ')}`
        : owed.runIds.length === 0
          ? 'the follow-up was approved, and nothing is subscribed to draft it (meeting.followup_owed)'
          : `the follow-up was approved, and run${owed.runIds.length === 1 ? '' : 's'} ${owed.runIds.map(id => `#${id}`).join(', ')} proposed no email`,
    };
  }
  const { meetingName } = await import('@/libs/actions/meeting-followup');
  for (const d of drafts) {
    await deps.emit(orgId, MEETING_FOLLOWUP_READY, {
      actionRunId: d.id,
      approvalRunId: approvalRunId > 0 ? approvalRunId : 0,
      documentId,
      owner: String(input.owner ?? ''),
      meetingTitle: meetingName({ title: String(input.title ?? '') }),
      to: d.to,
      subject: d.subject,
      attachments: d.attachments,
      roomId: Number(input.roomId ?? 0) || 0,
      link: `/dashboard/inbox/proposal-${d.id}`,
    }, `${MEETING_FOLLOWUP_READY}:${d.id}`);
  }
  return { outcome: 'drafted', documentId, proposals: drafts.map(d => d.id), detail: `${drafts.length} follow-up${drafts.length === 1 ? '' : 's'} in Review: ${drafts.map(d => `#${d.id} to ${d.to}${d.attachments > 0 ? ` with ${d.attachments} attachment${d.attachments === 1 ? '' : 's'}` : ''}`).join('; ')}` };
}

/**
 * The classifier's typed read of a meeting. Null when the read failed.
 * @param orgId - The workspace.
 * @param facts - The facts, as lines.
 */
export async function readMeeting(orgId: string, facts: string): Promise<MeetingRead | null> {
  try {
    const { z } = await import('zod');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const schema = z.object({
      counterpart: z.enum(COUNTERPARTS).describe('Who the people outside the owner\'s side were to the owner\'s business. client: an existing customer, an engagement under way, a proposal or delivery under review. prospect: someone being sold to — an intro, a discovery or sales call, a demo, a buyer evaluating. partner: a referral, channel or co-selling partner. vendor: someone selling to us or supplying us. candidate: a hiring conversation. internal: only our own people. personal: not business. other: none of these.'),
      followUpOwed: z.boolean().describe('True when the owner\'s side should send the people outside a written follow-up after this call: something was asked, promised, decided or booked, or the relationship moves on a recap. False for a call that closed itself out, or where nothing is owed in writing.'),
      why: z.string().max(240).describe('One line: what in the record settles both answers.'),
    });
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as unknown as { bindTools: (tools: unknown[], opts: unknown) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: Array<{ name: string; args: unknown }> }> } };
    const report = tool(async () => 'recorded', { name: 'report_meeting', description: 'Report who the meeting was with and whether a follow-up is owed.', schema: schema as never });
    const res = await model.bindTools([report], { tool_choice: 'report_meeting' }).invoke([
      new SystemMessage('You read the record of one business meeting — its title, people and the opening of its transcript or notes — and say who the people outside the owner\'s side were and whether a written follow-up is owed. Judge only from the record. Answer only through the tool.'),
      new HumanMessage(facts),
    ]);
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    await chargeModelCall({ orgId, feature: FEATURES.MEETING_READ, role: 'classifier', response: res as never }).catch(() => undefined);
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_meeting');
    const parsed = call ? schema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('meeting follow-up: the meeting read failed', { orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * The opening of a captured document's text, in chunk order.
 * @param orgId - The workspace.
 * @param documentId - The document.
 */
async function documentText(orgId: string, documentId: number): Promise<string> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeChunkSchema } = await import('@/models/Schema');
  const chunks = await db
    .select({ content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, documentId)))
    .orderBy(knowledgeChunkSchema.chunkIdx)
    .limit(16);
  return chunks.map(c => c.content).join('\n').slice(0, READ_CHARS);
}

/**
 * The room the capture was filed in, the newest deck and document on it, and
 * the next meeting on the calendar with anyone outside who was on this one.
 * Each lookup that fails is simply absent: the drafter works with less.
 * @param orgId - The workspace.
 * @param capture - The capture.
 * @param now - The clock.
 */
export async function meetingContext(orgId: string, capture: MeetingCapture, now: Date = new Date()): Promise<MeetingContext> {
  const out: MeetingContext = { room: null, deck: null, document: null, nextMeeting: null };
  try {
    const { roomsForDocuments } = await import('@/services/DataRoomService');
    const room = (await roomsForDocuments(orgId, [capture.documentId])).get(capture.documentId);
    if (room) {
      out.room = { id: room.id, title: room.title };
      const { listArtifactsForRecords } = await import('@/services/ArtifactService');
      const { latestDocument } = await import('@/services/proposals/board');
      const artifacts = await listArtifactsForRecords({ orgId, recordType: 'object', recordIds: [String(room.id)] });
      const deck = latestDocument(artifacts, room.meta.deliverables ?? [], 'deck');
      const doc = latestDocument(artifacts, room.meta.deliverables ?? [], 'document');
      out.deck = deck ? { id: deck.id, title: deck.title } : null;
      out.document = doc ? { id: doc.id, title: doc.title } : null;
    }
  } catch (err) {
    console.warn('meeting follow-up: the room lookup failed', { orgId, documentId: capture.documentId, message: (err as Error).message });
  }
  try {
    out.nextMeeting = capture.external.length > 0 ? await nextMeetingWith(orgId, capture.external, now) : null;
  } catch (err) {
    console.warn('meeting follow-up: the calendar lookup failed', { orgId, documentId: capture.documentId, message: (err as Error).message });
  }
  return out;
}

/**
 * The earliest calendar event after `now` that any of these people are on.
 * @param orgId - The workspace.
 * @param people - Lowercased addresses.
 * @param now - The clock.
 */
async function nextMeetingWith(orgId: string, people: string[], now: Date): Promise<{ title: string; start: string } | null> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeDocumentSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${knowledgeDocumentSchema.metadata}->>'kind' = 'calendar-event'`,
      sql`${knowledgeDocumentSchema.metadata}->>'start' > ${now.toISOString()}`,
    ))
    .limit(500);
  const wanted = new Set(people);
  const hits = rows
    .map(r => ({ title: r.title ?? 'Meeting', start: String(r.metadata?.start ?? ''), attendees: (Array.isArray(r.metadata?.attendees) ? r.metadata.attendees : []) as unknown[] }))
    .filter(r => r.start && r.attendees.some(a => typeof a === 'string' && wanted.has(a.toLowerCase())))
    .sort((a, b) => a.start.localeCompare(b.start));
  return hits[0] ? { title: hits[0].title, start: hits[0].start } : null;
}

/**
 * The `gmail.send` proposals the named mission runs made, read off their
 * envelope — still open or already run.
 * @param orgId - The workspace.
 * @param missionRunIds - The runs.
 */
async function draftsOf(orgId: string, missionRunIds: number[]): Promise<Array<{ id: number; to: string; subject: string; attachments: number }>> {
  if (missionRunIds.length === 0) {
    return [];
  }
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'gmail.send'),
      inArray(actionRunSchema.status, ['pending', 'approved', 'executing', 'done']),
      inArray(sql<number>`(${actionRunSchema.proposal}->>'missionRunId')::int`, missionRunIds),
    ));
  return rows.map(r => ({
    id: r.id,
    to: String(r.input?.to ?? ''),
    subject: String(r.input?.subject ?? ''),
    attachments: Array.isArray(r.input?.attachments) ? r.input.attachments.length : 0,
  }));
}

/** The production wiring. */
function productionDeps(): MeetingFollowupDeps {
  return {
    capture: async (orgId, documentId) => (await import('@/services/meetings/captures')).loadCapture(orgId, documentId),
    handled: async (orgId, _capture, key) => {
      const { discoveryCardsFor, followupCardFor } = await import('@/services/meetings/followupCards');
      const [card, discovery] = await Promise.all([followupCardFor(orgId, key), discoveryCardsFor(orgId, key)]);
      return { card: card?.id ?? null, discoveryPending: discovery.pending, discoveryApproved: discovery.approved };
    },
    text: documentText,
    read: readMeeting,
    context: (orgId, capture) => meetingContext(orgId, capture),
    file: async (orgId, input, read, agentSlug) => {
      const { proposeAction } = await import('@/services/ActionService');
      const { MEETING_FOLLOWUP_ACTION } = await import('@/libs/actions/meeting-followup');
      const res = await proposeAction({
        orgId,
        actionId: MEETING_FOLLOWUP_ACTION,
        input,
        // Filed for the seat that will write it; on the never-auto list, so it always waits on a person.
        principal: { kind: 'agent', id: `agent:${agentSlug}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${agentSlug}`,
        internal: true,
        proposal: {
          confidence: 0.9,
          rationale: `${read.counterpart} call: ${read.why}`,
          agentSlug,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'A follow-up is owed after this call, and approving drafts it for your review.',
        },
      });
      return { runId: res.runId, outcome: res.outcome };
    },
    supersede: async (orgId, runIds, by) => (await import('@/services/meetings/followupCards')).supersedeDiscoveryCards(orgId, runIds, by),
    emit: async (orgId, type, payload, dedupeKey) => {
      const { emitEvent } = await import('@/services/EventService');
      // Inline on purpose: the drafting run finishes before this returns, so
      // what it proposed can be found and its owner told.
      const res = await emitEvent({ orgId, type, payload, dedupeKey, invokedBy: `job:${MEETING_FOLLOWUP_JOB}`, dispatchMode: 'inline' });
      return {
        deduped: res.deduped,
        runIds: res.triggered.filter(t => t.slug.startsWith('automation:') && t.runId > 0).map(t => t.runId),
        skipped: res.skipped.map(s => ({ slug: s.slug, reason: s.reason })),
      };
    },
    drafts: draftsOf,
  };
}
