/**
 * The Google calls a person's own assistant makes with THEIR login: search
 * and read mail, write a reply into Drafts, read the calendar, find and read
 * files (docs/guides/personal-connections.md).
 *
 * Every call takes the person's own credential bag, found by
 * `personalCredential` and nothing else, and the personal workspace it is
 * stored in (a login refreshes on the app it was issued to). No client or
 * token is cached here beyond `resolveGoogleAccessToken`'s access-token cache,
 * which is keyed on the refresh token itself, so one person's token can never
 * answer for another's.
 *
 * NEVER SENDS. The Gmail scope that allows drafts (`gmail.compose`) also
 * allows sending, and Google offers nothing narrower, so the guarantee lives
 * here: no function in this file calls `messages.send` or `drafts.send`, and
 * `google.test.ts` fails if one is ever added.
 *
 * Nothing read here is stored: results go back to the turn as text and are
 * not ingested, embedded or written to a source.
 */

import { Buffer } from 'node:buffer';
import { exportMimeFor } from '@/libs/sources/drive';
import { fetchGmailThreadDoc, resolveThreadIdForMessage } from '@/libs/sources/gmail';
import { resolveGoogleAccessToken } from '@/libs/sources/googleAuth';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const TIMEOUT_MS = 20_000;

/** How much of one thread or file goes back to the turn. */
export const READ_CHARS = 20_000;

/** The person's own Google login, as `personalCredential` found it. */
export type GoogleGrant = { orgId: string; values: Record<string, unknown> };

/** A Google API answer that was not 2xx, with the status a person can be told. */
export class GoogleCallError extends Error {
  constructor(public readonly what: string, public readonly status: number) {
    super(`Google refused ${what} (${status})`);
    this.name = 'GoogleCallError';
  }
}

/**
 * GET or POST one Google endpoint as the person.
 * @param grant - Their login.
 * @param what - What the call is, for the error.
 * @param url - The endpoint.
 * @param init - Method and body, when not a GET.
 * @param init.method
 * @param init.body
 */
async function googleJson<T>(grant: GoogleGrant, what: string, url: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const token = await resolveGoogleAccessToken(grant.values, grant.orgId);
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init ? { 'content-type': 'application/json' } : {}) },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new GoogleCallError(what, res.status);
  }
  return (await res.json()) as T;
}

type Header = { name: string; value: string };
type MessageMeta = { id: string; threadId?: string; snippet?: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: Header[] } };

function headerOf(msg: MessageMeta, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** One message in a search result. */
export type MailHit = { id: string; threadId: string; from: string; subject: string; date: string; snippet: string; unread: boolean };

/**
 * Search the person's mail with Gmail's own query language.
 * @param grant - Their login.
 * @param query - A Gmail query (`from:… newer_than:7d is:unread`).
 * @param max - How many messages, at most 25.
 */
export async function mailSearch(grant: GoogleGrant, query: string, max = 10): Promise<MailHit[]> {
  const limit = Math.min(Math.max(max, 1), 25);
  const list = await googleJson<{ messages?: Array<{ id: string; threadId: string }> }>(grant, 'the mail search', `${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(limit) })}`);
  const ids = (list.messages ?? []).slice(0, limit);
  const metas = await Promise.all(ids.map(m => googleJson<MessageMeta>(
    grant,
    'a message',
    `${GMAIL}/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
  )));
  return metas.map(m => ({
    id: m.id,
    threadId: m.threadId ?? m.id,
    from: headerOf(m, 'From'),
    subject: headerOf(m, 'Subject') || '(no subject)',
    date: headerOf(m, 'Date'),
    snippet: m.snippet ?? '',
    unread: (m.labelIds ?? []).includes('UNREAD'),
  }));
}

/** A whole thread, as text. */
export type MailThread = { threadId: string; title: string; content: string; truncated: boolean };

/**
 * Read one whole thread, by its id or any message id in it.
 * @param grant - Their login.
 * @param ref - The thread id or a message id.
 * @param ref.threadId - A thread id.
 * @param ref.messageId - Any message id in the thread.
 */
export async function mailRead(grant: GoogleGrant, ref: { threadId?: string; messageId?: string }): Promise<MailThread | null> {
  const threadId = ref.threadId ?? (ref.messageId ? await resolveThreadIdForMessage({ orgId: grant.orgId, credentials: grant.values, messageId: ref.messageId }) : null);
  if (!threadId) {
    return null;
  }
  const doc = await fetchGmailThreadDoc({ orgId: grant.orgId, credentials: grant.values, threadId });
  if (!doc) {
    return null;
  }
  return { threadId, title: doc.title ?? '(no subject)', content: doc.content.slice(0, READ_CHARS), truncated: doc.content.length > READ_CHARS };
}

/**
 * One RFC 2822 header value with no line breaks, so a subject or an address
 * cannot inject another header.
 * @param value - The raw value.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 encoding for a header value that is not plain ASCII.
 * @param value - The value.
 */
function encodedWord(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** The draft that was written. */
export type MailDraft = { draftId: string; threadId: string; to: string; subject: string; link: string };

/**
 * Write a reply into the person's Gmail Drafts, threaded under the message it
 * answers. Writes a draft and nothing else: it is never sent from here.
 * @param grant - Their login.
 * @param input - What to reply to, and with what.
 * @param input.threadId - The thread to reply in (its newest message is answered).
 * @param input.messageId - Or the message to answer.
 * @param input.body - The reply, plain text.
 * @param input.to - Override the recipient (defaults to the sender, or their Reply-To).
 * @param input.cc - Anyone to copy.
 */
export async function mailDraftReply(grant: GoogleGrant, input: { threadId?: string; messageId?: string; body: string; to?: string; cc?: string }): Promise<MailDraft | null> {
  const headers = 'metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References';
  let original: MessageMeta | null = null;
  if (input.messageId) {
    original = await googleJson<MessageMeta>(grant, 'the message', `${GMAIL}/messages/${encodeURIComponent(input.messageId)}?format=metadata&${headers}`);
  } else if (input.threadId) {
    const thread = await googleJson<{ messages?: MessageMeta[] }>(grant, 'the thread', `${GMAIL}/threads/${encodeURIComponent(input.threadId)}?format=metadata&${headers}`);
    original = thread.messages?.at(-1) ?? null;
  }
  if (!original) {
    return null;
  }
  const subjectRaw = headerOf(original, 'Subject');
  const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw || '(no subject)'}`;
  const to = oneLine(input.to ?? (headerOf(original, 'Reply-To') || headerOf(original, 'From')));
  const messageIdHeader = oneLine(headerOf(original, 'Message-ID'));
  const references = oneLine([headerOf(original, 'References'), messageIdHeader].filter(Boolean).join(' '));
  const lines = [
    `To: ${to}`,
    ...(input.cc ? [`Cc: ${oneLine(input.cc)}`] : []),
    `Subject: ${encodedWord(oneLine(subject))}`,
    ...(messageIdHeader ? [`In-Reply-To: ${messageIdHeader}`, `References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body.replace(/\r?\n/g, '\r\n'),
  ];
  const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  const threadId = original.threadId ?? input.threadId ?? '';
  const draft = await googleJson<{ id: string; message?: { threadId?: string } }>(grant, 'the draft', `${GMAIL}/drafts`, {
    method: 'POST',
    body: { message: { raw, ...(threadId ? { threadId } : {}) } },
  });
  const email = typeof grant.values.email === 'string' ? grant.values.email : '';
  return {
    draftId: draft.id,
    threadId: draft.message?.threadId ?? threadId,
    to,
    subject,
    link: `https://mail.google.com/mail/${email ? `?authuser=${encodeURIComponent(email)}` : ''}#drafts`,
  };
}

/** A calendar event as Google returns it, as much as the turn needs. */
export type CalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string };
};

/**
 * The person's primary calendar between two instants, in start order.
 * @param grant - Their login.
 * @param timeMin - From (ISO).
 * @param timeMax - Until (ISO).
 */
export async function calendarEvents(grant: GoogleGrant, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeMin, timeMax });
  const list = await googleJson<{ items?: CalendarEvent[] }>(grant, 'the calendar', `${CALENDAR}/calendars/primary/events?${params}`);
  return list.items ?? [];
}

/** One file in a Drive search. */
export type DriveHit = { id: string; name: string; mimeType: string; modified: string | null; link: string | null; owner: string | null };

/**
 * Escape a value for a Drive query's single-quoted string.
 * @param value - The raw value.
 */
function driveQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
}

/**
 * Find the person's files by their contents and names, newest first.
 * @param grant - Their login.
 * @param query - Words to find.
 * @param max - How many, at most 25.
 */
export async function driveSearch(grant: GoogleGrant, query: string, max = 10): Promise<DriveHit[]> {
  const q = `(fullText contains '${driveQuoted(query)}' or name contains '${driveQuoted(query)}') and trashed = false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(Math.min(Math.max(max, 1), 25)),
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const list = await googleJson<{ files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string; owners?: Array<{ displayName?: string }> }> }>(grant, 'the file search', `${DRIVE}/files?${params}`);
  return (list.files ?? []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modified: f.modifiedTime ?? null, link: f.webViewLink ?? null, owner: f.owners?.[0]?.displayName ?? null }));
}

/** One file's text, or why there is none. */
export type DriveFileText
  = | { ok: true; name: string; link: string | null; text: string; truncated: boolean }
    | { ok: false; name: string; link: string | null; why: string };

const TEXT_MIME = /^(?:text\/|application\/(?:json|xml|csv))/;

/**
 * Read one file as text: a Google Doc, Sheet or Slides through its export, a
 * text file as it is. Anything else answers with its link and why.
 * @param grant - Their login.
 * @param fileId - The file.
 */
export async function driveRead(grant: GoogleGrant, fileId: string): Promise<DriveFileText> {
  const meta = await googleJson<{ name: string; mimeType: string; webViewLink?: string }>(grant, 'the file', `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=name,mimeType,webViewLink&supportsAllDrives=true`);
  const link = meta.webViewLink ?? null;
  const target = exportMimeFor(meta.mimeType);
  const url = target
    ? `${DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(target)}`
    : TEXT_MIME.test(meta.mimeType) ? `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true` : null;
  if (!url) {
    return { ok: false, name: meta.name, link, why: `It is a ${meta.mimeType} file, which cannot be read as text here; open it from its link.` };
  }
  const token = await resolveGoogleAccessToken(grant.values, grant.orgId);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new GoogleCallError('the file\'s text', res.status);
  }
  const text = await res.text();
  return { ok: true, name: meta.name, link, text: text.slice(0, READ_CHARS), truncated: text.length > READ_CHARS };
}
