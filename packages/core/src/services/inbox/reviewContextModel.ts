/**
 * What a reviewer needs beside an email proposal before approving it — pure,
 * so the shape is testable without HubSpot or the mailbox.
 *
 * Chris, 2026-09-18: "I'm most interested in seeing the inbound lead info,
 * and any inbox/outbox from knowledge or HubSpot, and sequence enrollment.
 * So I make sure I'm not double sending." Three sections, each honest about
 * what it could not read (design principle 10): `not-connected` when the
 * system is not wired to this workspace, `error` with the system's own words
 * when a read failed, `none` when it worked and found nothing.
 */

export type SectionStatus = 'ok' | 'none' | 'not-connected' | 'error';

export type Section<T> = { status: 'ok'; data: T } | { status: 'none' } | { status: 'not-connected' } | { status: 'error'; message: string };

export type ContactFacts = {
  hubspotId: string;
  name: string | null;
  email: string;
  company: string | null;
  jobTitle: string | null;
  lifecycleStage: string | null;
  /** Owner id, as HubSpot has it; a name when the caller resolved one. */
  owner: string | null;
  createdAt: string | null;
  /** Original source ("Organic search", "Offline — import") and its detail. */
  source: string | null;
  sourceDetail: string | null;
  /** The ad lead magnet they answered (`utm_content`), e.g. "Marketing Industry eBook". */
  utmContent?: string | null;
  /** In-app link to the contact, when the loader knew it. */
  href: string | null;
};

export type Touch = {
  /** `in` — they wrote to us; `out` — our side wrote to them. */
  direction: 'in' | 'out';
  subject: string;
  snippet: string;
  /** ISO. */
  at: string | null;
  /** Where this was read: the CRM's logged emails or the mailbox mirror. */
  source: 'hubspot' | 'gmail';
  /** In-app link (a mirror document's page), when there is one. */
  href: string | null;
};

export type EnrollmentFacts = {
  enrolled: boolean;
  sequenceName: string | null;
  enrolledBy: string | null;
};

export type ReviewContextModel = {
  /** The address the proposal is about, when it is about one. */
  email: string | null;
  contact: Section<ContactFacts>;
  /** Newest first, both systems merged. */
  touches: Section<Touch[]>;
  enrollment: Section<EnrollmentFacts>;
  /** What could make this send a double: a live sequence, a recent outbound. */
  warnings: string[];
};

/** How recent an outbound has to be to count as "you already wrote to them". */
export const RECENT_OUTBOUND_DAYS = 7;

/**
 * Merge, sort and warn. Sources are read separately; this decides what they
 * mean together.
 * @param input
 * @param input.email - The address the proposal is about.
 * @param input.contact - The CRM read.
 * @param input.hubspotTouches - Emails HubSpot logged for the contact.
 * @param input.mirrorTouches - Messages the mailbox mirror holds for the address.
 * @param input.enrollment - Sequence enrollment, when the CRM could say.
 * @param input.now - For the recency warning; injectable for tests.
 */
export function buildReviewContext(input: {
  email: string | null;
  contact: Section<ContactFacts>;
  hubspotTouches: Section<Touch[]>;
  mirrorTouches: Section<Touch[]>;
  enrollment: Section<EnrollmentFacts>;
  now?: Date;
}): ReviewContextModel {
  const now = input.now ?? new Date();
  const merged = [...(input.hubspotTouches.status === 'ok' ? input.hubspotTouches.data : []), ...(input.mirrorTouches.status === 'ok' ? input.mirrorTouches.data : [])]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  let touches: Section<Touch[]>;
  if (merged.length > 0) {
    touches = { status: 'ok', data: dedupe(merged) };
  } else if (input.hubspotTouches.status === 'error') {
    touches = input.hubspotTouches;
  } else if (input.mirrorTouches.status === 'error') {
    touches = input.mirrorTouches;
  } else if (input.hubspotTouches.status === 'not-connected' && input.mirrorTouches.status === 'not-connected') {
    touches = { status: 'not-connected' };
  } else {
    touches = { status: 'none' };
  }

  const warnings: string[] = [];
  if (input.enrollment.status === 'ok' && input.enrollment.data.enrolled) {
    warnings.push(`Already in a sequence${input.enrollment.data.sequenceName ? ` — ${input.enrollment.data.sequenceName}` : ''}. A send on top of it is a double touch.`);
  }
  if (touches.status === 'ok') {
    const recent = touches.data.find(t => t.direction === 'out' && t.at && (now.getTime() - Date.parse(t.at)) < RECENT_OUTBOUND_DAYS * 86_400_000);
    if (recent) {
      warnings.push(`Your side wrote to them ${daysAgo(recent.at!, now)} — "${recent.subject || '(no subject)'}". Check it before sending again.`);
    }
  }
  return { email: input.email, contact: input.contact, touches, enrollment: input.enrollment, warnings };
}

/**
 * The same message logged in HubSpot and mirrored from Gmail is one touch, not two.
 * @param touches
 */
function dedupe(touches: Touch[]): Touch[] {
  const seen = new Set<string>();
  return touches.filter((t) => {
    const key = `${t.direction}|${t.subject.trim().toLowerCase()}|${(t.at ?? '').slice(0, 10)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function daysAgo(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * The address a proposal is about: the email's recipient, or the address a
 * CRM contact record names. Null when the proposal is about a deal or a
 * company — there is no mailbox to check.
 * @param row
 * @param row.actionId
 * @param row.input
 * @param row.recordKey - The described record's key (`email:jane@acme.example`).
 */
export function contactEmailOf(row: { actionId: string; input: Record<string, unknown>; recordKey: string | null }): string | null {
  const to = typeof row.input.to === 'string' ? row.input.to.trim() : '';
  if (row.actionId === 'gmail.send' && to) {
    return firstAddress(to);
  }
  if (row.recordKey?.startsWith('email:')) {
    return firstAddress(row.recordKey.slice('email:'.length));
  }
  const email = typeof row.input.email === 'string' ? row.input.email.trim() : '';
  return email ? firstAddress(email) : null;
}

/**
 * `"Amy Larkin" <amy@northwind.example>, jordan@…` → `amy@northwind.example`.
 * @param raw
 */
function firstAddress(raw: string): string | null {
  const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(raw);
  return m ? m[0].toLowerCase() : null;
}
