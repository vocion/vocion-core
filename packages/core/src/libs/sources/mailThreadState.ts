import type { ReplyState, ThreadCategory } from '@/libs/retrieval/facets';
/**
 * The STATE of a mail thread, worked out once at sync and filed beside its
 * content as facets (`libs/retrieval/facets.ts`), so "what do I need to
 * answer" is one filtered query instead of twenty phrase searches.
 *
 * Two halves, deliberately separate:
 *
 *   - **Facts, read from headers.** Who wrote last, when each side last wrote,
 *     whether the owner has answered since the other side's last message, and
 *     whether the sender marked the mail as bulk (`List-Unsubscribe`,
 *     `Precedence: bulk`, `Auto-Submitted`). Structure, not meaning: no model,
 *     no cost, and a thread the owner answered last is `waiting_on_them`
 *     without anything being asked.
 *   - **Meaning, read by a small model.** Only for a thread the other side
 *     wrote last: does it ask the owner for something (`needs_my_reply`), is
 *     it something to read (`fyi`), or a cold pitch (`outbound_spam`); what is
 *     it about; and the ask in one line. One classifier call per thread that
 *     CHANGED — a thread whose last message is the one already labelled keeps
 *     its label and costs nothing (`reuse`).
 *
 * When the model is unavailable, refused by a cap, or the run's allowance is
 * spent, the facts alone decide: an unanswered, non-bulk thread reads as
 * `needs_my_reply`, labelled `rule`, and the next sync labels it properly.
 * Over-reporting one owed reply is recoverable; missing one is not.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { MAIL_THREAD_STATE_KIND, REPLY_STATES, THREAD_CATEGORIES } from '@/libs/retrieval/facets';

/** One message as the thread read gives it: headers and the provider's snippet. */
export type ThreadMessage = {
  id: string;
  from: string;
  to: string;
  cc?: string;
  date: Date;
  subject: string;
  snippet: string;
  /** The sender marked it bulk or automated (list mail, auto-replies). */
  bulk: boolean;
};

export type ThreadFacts = {
  threadId: string;
  /** The owner's address, lowercased. */
  mailbox: string;
  subject: string;
  /** The other side: the last sender who is not the owner, else the first recipient. */
  counterpart: string;
  lastMessageId: string;
  lastMessageAt: Date;
  lastDirection: 'inbound' | 'outbound';
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  messageCount: number;
  /** The last inbound message is bulk or automated. */
  bulk: boolean;
  /** The last few messages, oldest first, for the model and for the document's text. */
  recent: ThreadMessage[];
};

export type ThreadLabel = {
  state: ReplyState;
  category: ThreadCategory;
  /** What the other side wants, in one line; empty when nothing is asked. */
  ask: string;
  /** Who decided: the model by id, or `rule` when the facts alone did. */
  labelledBy: string;
  /** The prompt version a model label was made under (`LABEL_VERSION`); absent on a headers-only label. */
  version?: number;
};

/** How many of a thread's messages the label and the document read. */
export const RECENT_MESSAGES = 4;
const SNIPPET_MAX = 280;
const ASK_MAX = 160;

/**
 * The bare address in a header value: `Dana Reyes <dana@kestrel.example>` → `dana@kestrel.example`.
 * @param header - A From/To header value.
 */
export function addressOf(header: string): string {
  const angled = /<([^>]+)>/.exec(header);
  return (angled?.[1] ?? header).trim().toLowerCase();
}

/**
 * The facts of a thread from its messages' headers. Pure.
 * @param threadId - The provider's thread id.
 * @param messages - Every message in the thread, any order.
 * @param mailbox - The owner's address.
 */
export function threadFacts(threadId: string, messages: ThreadMessage[], mailbox: string): ThreadFacts | null {
  if (messages.length === 0) {
    return null;
  }
  const owner = mailbox.toLowerCase();
  const sorted = [...messages].sort((a, b) => a.date.getTime() - b.date.getTime());
  const isOwner = (m: ThreadMessage) => addressOf(m.from) === owner;
  const last = sorted[sorted.length - 1]!;
  const inbound = sorted.filter(m => !isOwner(m));
  const outbound = sorted.filter(isOwner);
  const lastInbound = inbound[inbound.length - 1];
  const lastOutbound = outbound[outbound.length - 1];
  const counterpart = lastInbound?.from ?? (last.to.split(',')[0] ?? '').trim();
  return {
    threadId,
    mailbox: owner,
    subject: sorted[0]!.subject || last.subject || '(no subject)',
    counterpart,
    lastMessageId: last.id,
    lastMessageAt: last.date,
    lastDirection: isOwner(last) ? 'outbound' : 'inbound',
    lastInboundAt: lastInbound?.date ?? null,
    lastOutboundAt: lastOutbound?.date ?? null,
    messageCount: sorted.length,
    bulk: lastInbound?.bulk ?? false,
    recent: sorted.slice(-RECENT_MESSAGES).map(m => ({ ...m, snippet: m.snippet.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX) })),
  };
}

/**
 * The label the facts alone settle, or null when meaning has to be read.
 *
 * The owner wrote last: they are waiting on the other side. The other side
 * wrote last but marked it bulk: nothing to answer. Anything else needs the
 * model — or, without one, falls back to `fallbackLabel`.
 * @param facts - The thread's facts.
 */
export function ruleLabel(facts: ThreadFacts): ThreadLabel | null {
  if (facts.lastDirection === 'outbound') {
    return { state: 'waiting_on_them', category: 'other', ask: '', labelledBy: 'rule' };
  }
  if (facts.bulk) {
    return { state: 'fyi', category: 'other', ask: '', labelledBy: 'rule' };
  }
  return null;
}

/**
 * The label when meaning could not be read: an unanswered, non-bulk thread is
 * owed until a model says otherwise.
 * @param facts - The thread's facts.
 */
export function fallbackLabel(facts: ThreadFacts): ThreadLabel {
  return ruleLabel(facts) ?? { state: 'needs_my_reply', category: 'other', ask: '', labelledBy: 'rule' };
}

/** What the model must answer. */
export const labelSchema = z.object({
  state: z.enum(['needs_my_reply', 'fyi', 'outbound_spam']),
  category: z.enum(THREAD_CATEGORIES).catch('other'),
  ask: z.string().catch('').transform(s => s.replace(/\s+/g, ' ').trim().slice(0, ASK_MAX)),
});

/**
 * The labelling prompt's version, stored on every model label (`label_version`).
 * Raise it with a prompt change that should reach labels already on file — and
 * then relabel ON PURPOSE (`npm run mail:backfill-thread-state -- --relabel`):
 * a sync keeps reusing an older label for an unchanged thread, so a deploy
 * never re-spends on its own.
 *
 * v2 (2026-10-09, after the first run on a real mailbox): labels read from the
 * OWNER's side. v1 filed cold pitches and investor outreach as "sales, owed a
 * reply" (the pitch asked a question), and a prospect's warm reply to the
 * owner's outreach as "partner" because it proposed working together — so
 * "what sales emails do I need to answer" listed 19 pitches and missed the one
 * live prospect.
 */
export const LABEL_VERSION = 2;

export const LABEL_SYSTEM = [
  'You label one email thread for the mailbox owner\'s reply queue, always from the OWNER\'s side. The other side wrote last.',
  'First decide who started it and who is selling. If the owner (or a colleague) wrote first, the thread is the owner\'s own outreach or an existing relationship. If a stranger wrote first, offering the owner a service, a product, an investment, a partnership or a meeting the owner never asked for, it is a cold approach.',
  'state: "needs_my_reply" when a reply from the owner is genuinely expected — a real question or request in a relationship the owner is part of, a reply to the owner\'s own outreach (even a short or tentative one), a customer, candidate or colleague waiting on them, a meeting to confirm;',
  '"outbound_spam" for any cold approach from a stranger the owner never engaged with — sales pitches, agencies, dev shops, lead-gen and podcast offers, "investment opportunities", follow-ups and "just bumping this" on any of those — even when it ends with a question or asks for a call;',
  '"fyi" when there is nothing to answer — notices, receipts, calendar updates, newsletters, a closing "thanks".',
  'category, from the owner\'s side: sales = the owner selling — their prospects and deals, replies to the owner\'s outreach, proposals, pricing (a prospect who proposes "collaborating" in reply to the owner\'s outreach is still sales); customer = existing clients; vendor = anyone selling TO the owner, including every cold pitch; partner = an established partner the owner already works with; hiring; internal (colleagues); personal; other.',
  'ask: what the other side wants from the owner, in one short line in plain words (e.g. "Wants a call next week to discuss pricing"); empty when nothing is asked.',
  'Answer with a JSON object only: {"state": …, "category": …, "ask": …}.',
].join(' ');

/**
 * The user message for one thread: headers and snippets, never a body.
 * @param facts - The thread's facts.
 */
export function labelPrompt(facts: ThreadFacts): string {
  const lines = [`Mailbox owner: ${facts.mailbox}`, `Subject: ${facts.subject}`, `Messages in thread: ${facts.messageCount}`, ''];
  for (const m of facts.recent) {
    lines.push(`From: ${m.from}`, `Date: ${m.date.toISOString()}`, m.snippet, '');
  }
  return lines.join('\n');
}

/**
 * Parse the model's reply into a label, or null when it is not one.
 * @param raw - The reply text.
 * @param model - The model id that wrote it.
 */
export function parseLabel(raw: string, model: string): ThreadLabel | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = labelSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? { ...parsed.data, labelledBy: model, version: LABEL_VERSION } : null;
  } catch {
    return null;
  }
}

/**
 * The external id a thread's state document is filed under.
 * @param connector
 * @param threadId
 */
export function threadStateExternalId(connector: string, threadId: string): string {
  return `${connector}-thread-state:${threadId}`;
}

/**
 * The document a thread's state is filed as: text a person (and the embedder)
 * reads, and the facets a filter reads.
 *
 * The text leads with the state and the ask, so a semantic query ("sales",
 * "pricing") ranks threads by what they are about within a facet filter, and
 * a hit reads as an answer: who, what they want, since when.
 * @param facts - The thread's facts.
 * @param label - Its label.
 * @param opts - Where it came from.
 * @param opts.connector - The connector slug, for the external id.
 * @param opts.uri - A link to the thread, when the provider has one.
 */
export function threadStateDoc(facts: ThreadFacts, label: ThreadLabel, opts: { connector: string; uri?: string }): IngestDoc {
  const stateWords: Record<ReplyState, string> = {
    needs_my_reply: 'Reply owed',
    waiting_on_them: 'Waiting on them',
    fyi: 'FYI',
    outbound_spam: 'Cold pitch',
  };
  const who = facts.counterpart || '(unknown)';
  const content = [
    `${stateWords[label.state]} — ${facts.subject} — ${who}`,
    label.ask ? `Ask: ${label.ask}` : '',
    `Category: ${label.category}. ${facts.messageCount} message${facts.messageCount === 1 ? '' : 's'}.`,
    facts.lastInboundAt ? `They last wrote ${facts.lastInboundAt.toISOString()}.` : '',
    facts.lastOutboundAt ? `You last wrote ${facts.lastOutboundAt.toISOString()}.` : 'You have not written in this thread.',
    '',
    ...facts.recent.map(m => `${m.from} (${m.date.toISOString()}): ${m.snippet}`),
  ].filter(l => l !== '').join('\n');
  return {
    externalId: threadStateExternalId(opts.connector, facts.threadId),
    title: `${stateWords[label.state]}: ${facts.subject} — ${who}`,
    content,
    ...(opts.uri ? { uri: opts.uri } : {}),
    lastModifiedAt: facts.lastMessageAt,
    metadata: {
      kind: MAIL_THREAD_STATE_KIND,
      threadId: facts.threadId,
      subject: facts.subject,
      from: who,
      // The last few messages as data, so a reply draft can show what it
      // answers without re-reading the thread (`recentMessagesOf`).
      recent: facts.recent.map(m => ({ from: m.from, at: m.date.toISOString(), snippet: m.snippet })),
      facets: {
        reply_state: label.state,
        category: label.category,
        counterpart: who,
        mailbox: facts.mailbox,
        last_inbound_at: facts.lastInboundAt?.toISOString() ?? null,
        last_outbound_at: facts.lastOutboundAt?.toISOString() ?? null,
        last_message_id: facts.lastMessageId,
        ask: label.ask,
        labelled_by: label.labelledBy,
        ...(label.version ? { label_version: label.version } : {}),
      },
    },
  };
}

/** A previously filed label, as `reuse` reads it. */
export type PriorLabel = { lastMessageId: string; label: ThreadLabel };

/**
 * The label already on file, when it still describes the thread: same last
 * message, and decided by a model (a `rule` fallback is retried).
 * @param prior - What the index holds for the thread, if anything.
 * @param facts - The thread as read now.
 * @param opts - What a relabel asks for.
 * @param opts.minVersion - Only a label made under at least this prompt version is kept.
 */
export function reuse(prior: PriorLabel | undefined, facts: ThreadFacts, opts: { minVersion?: number } = {}): ThreadLabel | null {
  if (!prior || prior.lastMessageId !== facts.lastMessageId || prior.label.labelledBy === 'rule') {
    return null;
  }
  // Only an explicit relabel asks for a newer prompt; a sync keeps what it has.
  if (opts.minVersion && (prior.label.version ?? 1) < opts.minVersion) {
    return null;
  }
  return prior.label;
}

/**
 * A prior label from a stored document's metadata, or undefined.
 * @param metadata - `knowledge_document.metadata`.
 */
export function priorFromMetadata(metadata: Record<string, unknown> | null | undefined): PriorLabel | undefined {
  const f = (metadata?.facets ?? null) as Record<string, unknown> | null;
  if (!f || typeof f.last_message_id !== 'string') {
    return undefined;
  }
  const state = REPLY_STATES.includes(f.reply_state as ReplyState) ? f.reply_state as ReplyState : null;
  if (!state) {
    return undefined;
  }
  return {
    lastMessageId: f.last_message_id,
    label: {
      state,
      category: THREAD_CATEGORIES.includes(f.category as ThreadCategory) ? f.category as ThreadCategory : 'other',
      ask: typeof f.ask === 'string' ? f.ask : '',
      labelledBy: typeof f.labelled_by === 'string' ? f.labelled_by : 'rule',
      // Labels from before versions existed were made by the first prompt.
      version: typeof f.label_version === 'number' ? f.label_version : 1,
    },
  };
}

/** One message of a thread as a reply draft shows it: who, when, and the opening words. */
export type RecentMessage = { from: string; at: string; snippet: string };

const RECENT_LINE = /^(.+?) \((\d{4}-\d{2}-\d{2}T[\d:.]+Z)\): (.*)$/;

/**
 * A thread-state document's last messages, oldest first: from its metadata
 * when it was filed with them, else read back off the lines its text was
 * written with (`threadStateDoc`), so a thread synced before the metadata
 * carried them still shows. Pure.
 * @param metadata - The document's metadata.
 * @param content - The document's text.
 */
export function recentMessagesOf(metadata: Record<string, unknown> | null | undefined, content?: string | null): RecentMessage[] {
  const stored = metadata?.recent;
  if (Array.isArray(stored)) {
    return stored
      .filter((m): m is RecentMessage => !!m && typeof m === 'object' && typeof (m as RecentMessage).from === 'string' && typeof (m as RecentMessage).at === 'string')
      .map(m => ({ from: m.from, at: m.at, snippet: typeof m.snippet === 'string' ? m.snippet : '' }));
  }
  const out: RecentMessage[] = [];
  for (const line of (content ?? '').split('\n')) {
    const m = RECENT_LINE.exec(line.trim());
    if (m) {
      out.push({ from: m[1]!, at: m[2]!, snippet: m[3]! });
    }
  }
  return out;
}
