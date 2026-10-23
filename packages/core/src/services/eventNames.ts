/**
 * Event names that code outside the bus emits, in a leaf so naming one does
 * not import `services/EventService.ts` and everything it reaches
 * (`libs/eventBridge.ts`).
 */

/**
 * A credential was stored for a connector: a vendor login finished, a GitHub
 * App installation was recorded, or a person pasted a key. Emitted from the
 * one place every path goes through (`storeCredentialForSource`), so a plugin
 * can carry setup on from here — file the records the connection makes
 * possible, start the first read — instead of waiting for a person to come
 * back to chat. Not emitted for a token refresh, which changes nothing a
 * person did.
 */
export const SOURCE_CONNECTED = 'source.connected';

/**
 * A meeting's record arrived and settled: a recording with its transcript, or
 * a note-taker's note that stopped changing. Raised once per captured
 * document after the sync that brought it (`services/meetings/captures.ts`),
 * with the facts read from metadata only — who owned it, who attended, which
 * of them are outside the owner's domain, the room it was filed in. Nothing
 * here reads the words; what the meeting WAS is the subscriber's model read.
 */
export const MEETING_TRANSCRIPT_READY = 'meeting.transcript_ready';

/**
 * A meeting was read as one with a client or prospect after which a
 * follow-up is owed (`services/jobs/meetingFollowup.ts`). Raised once per
 * meeting — two captures of one call (a recording and a note) are one
 * meeting — and carries what the drafter needs: the people, the room, the
 * deliverable on it, the next meeting already on the calendar.
 */
export const MEETING_FOLLOWUP_OWED = 'meeting.followup_owed';

/**
 * The follow-up owed after a meeting is waiting in Review: the proposal it
 * became, who it goes to, and the meeting's owner, so a notification can tell
 * them. Raised by the same job once the drafting run proposed it.
 */
export const MEETING_FOLLOWUP_READY = 'meeting.followup_ready';

/**
 * A meeting's follow-up card is waiting for the person who owns the meeting:
 * "Approve to draft the <meeting> follow-up". Raised when the card is filed,
 * once per card, so a notification can tell them while the call is fresh.
 */
export const MEETING_FOLLOWUP_AWAITING = 'meeting.followup_awaiting';

/**
 * A person approved a meeting's follow-up card (`meeting.draft_followup`):
 * the call's record is released to the writer and the draft is to start.
 * Carries the card's input and `approvalRunId`.
 */
export const MEETING_FOLLOWUP_APPROVED = 'meeting.followup_approved';
