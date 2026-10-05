/**
 * THE THREAD FOLLOWS THE REQUEST (backlog 057; Chris, 2026-10-04: "I want to
 * at-mention Vocion … build the fix with evidence and share it in the Slack
 * channel"). A request asked for in a Slack thread is answered there, once,
 * and then goes quiet while the factory works. This job posts each move the
 * record makes back into that thread — filed, building, in QA, merged,
 * shipped, seen live — in the sentence the step was written with, so the
 * people who asked never have to open Vocion to know where it stands.
 *
 * When the move WAITS ON A PERSON (the type's `x-needs-you`: a merge card is
 * up), the thread gets the evidence the card shows — the feature demo
 * recorded from the branch (backlog 058) — and is told that a reply here
 * decides it (`services/chat/slackApproval.ts`). Approval in Slack is of
 * something seen working, as it is in the app.
 *
 * Driven by `record.status_marked` (one event per status write) through a
 * plugin automation that names the type it follows; nothing here names one.
 * The thread is found from the record's origin conversation, whose scope is
 * the Slack thread it was created for (`ChatSurfaceService.handleInbound`).
 * The record's page is the one its workspace declares for the type. A record
 * that did not come from Slack posts nothing. Each line is posted once: the
 * outbound record (`slack_post`) remembers it.
 */
import type { RecordStatusMarkedPayload } from '@/services/EventService';
import process from 'node:process';
import { appBaseUrl } from '@/libs/links';

export const SLACK_THREAD_FOLLOW_JOB = 'slack-thread-follow';
/** The job that carries a filed recording into the thread (`recording.filed`, filtered by the plugin to the roles it wants there). */
export const SLACK_THREAD_RECORDING_JOB = 'slack-thread-recording';

/** A Slack thread named by a conversation's scope: `slack:<channel>:<thread ts>`. */
export type SlackThreadRef = { channelId: string; threadTs: string };

/** The card waiting on a person for this record, as the thread shows it. */
export type WaitingCard = {
  runId: number;
  title: string;
  /** The card's own verbs ("Merge" / "Hold"), else approve / reject. */
  verbs: { approve: string; reject: string };
  /** The recording the card plays, when it has one. */
  video: { url: string; caption: string } | null;
};

/** A file the thread post carries, read from the media store and uploaded. */
export type ThreadAttachment = { url: string; caption: string };

/**
 * The Slack thread a conversation was created for, from its scope ref, or
 * null when the conversation did not come from Slack.
 * @param scopeRef - The conversation's `scopeRef`.
 */
export function slackThreadOfScope(scopeRef: string | null | undefined): SlackThreadRef | null {
  const m = /^slack:([^:]+):([^:]+)$/.exec(scopeRef ?? '');
  return m ? { channelId: m[1]!, threadTs: m[2]! } : null;
}

/**
 * What the thread reads for one move: the step's own sentence; when a card
 * waits, how to decide it from here; then the record's page. No agent voice,
 * no restating what the person asked.
 * @param payload - The move.
 * @param href - The record's page, absolute, or null when the app has no public address.
 * @param waiting - The card waiting on a person, when the move waits on one.
 */
export function followText(payload: Pick<RecordStatusMarkedPayload, 'line' | 'value'>, href: string | null, waiting: Pick<WaitingCard, 'verbs'> | null = null): string {
  const line = payload.line.trim() || `Now ${payload.value.replace(/_/g, ' ')}.`;
  const sentence = /[.!?…]$/.test(line) ? line : `${line}.`;
  const decide = waiting ? `${waiting.verbs.approve} or ${waiting.verbs.reject}: reply here, or decide it in Vocion.` : null;
  return [sentence, decide, href].filter((s): s is string => Boolean(s)).join('\n');
}

/**
 * The generic record page, absolute, when the app knows its own address.
 * The default `pageHref` dep prefers the page the workspace declares.
 * @param recordId
 */
export function recordHref(recordId: number): string | null {
  const base = appBaseUrl();
  return base ? `${base}/dashboard/objects/${recordId}` : null;
}

/** The record as the done message reads it. */
export type DoneFacts = { title: string; live: 'seen' | 'partial' | 'not_seen' | 'not_checked' | null; reached: number; total: number; shareUrl: string | null };

/**
 * ONE FRIENDLY MESSAGE WHEN IT IS DONE (Chris, 2026-10-05: "send one friendly message into Slack
 * (where the conversation happened) letting the user know it's done in prod and tested"). Fixed
 * words over the record's facts — nobody's sentence is rewritten. Null when it is not yet done
 * in the way a person wants to hear: shipped but not yet checked live waits for the check.
 * @param facts - The record.
 * @param href - Its page, absolute, or null.
 */
export function doneText(facts: DoneFacts, href: string | null): string | null {
  if (facts.live !== 'seen') {
    return null;
  }
  const all = facts.reached === facts.total;
  const checked = facts.total > 0 ? ` and tested: ${all ? 'everything you asked for was' : `${facts.reached} of ${facts.total} things you asked for were`} seen working on production` : ' and checked on production';
  return [`Done ✅ "${facts.title}" is live in production${checked}.`, href ? `Feature page: ${href}` : null, facts.shareUrl ? `Share it: ${facts.shareUrl}` : null].filter(Boolean).join('\n');
}

export type SlackThreadFollowResult
  = | { posted: true; channelId: string; threadTs: string; text: string; attached: boolean }
    | { posted: false; reason: string };

export type SlackThreadFollowDeps = {
  /** The record's origin conversation id, or null. */
  originConversation: (orgId: string, recordId: number) => Promise<number | null>;
  /** The conversation's scope ref. */
  scopeOf: (orgId: string, conversationId: number) => Promise<string | null>;
  /** The record's page, absolute, or null when the app has no public address. */
  pageHref: (orgId: string, typeSlug: string | null, recordId: number) => Promise<string | null>;
  /** The newest card still waiting on a person whose origin is this conversation. */
  waitingCard: (orgId: string, conversationId: number) => Promise<WaitingCard | null>;
  /** Our earlier posts in the thread, for the once-only rule. */
  alreadyPosted: (channelId: string, threadTs: string, text: string) => Promise<boolean>;
  /** Post into the thread; returns the message ts, or null when Slack gave none. */
  post: (ref: SlackThreadRef, text: string) => Promise<string | null>;
  /** Upload a file from the media store into the thread, under the post. True when Slack took it. */
  attach: (orgId: string, ref: SlackThreadRef, file: ThreadAttachment) => Promise<boolean>;
  /** The words a filed recording is posted with: its caption, else its title. */
  captionOf: (orgId: string, artifactId: number) => Promise<string | null>;
  /** Whether this thread already carries a post for this URL (a recording filed on two records, or re-fired). */
  alreadyAttached: (channelId: string, threadTs: string, url: string) => Promise<boolean>;
  /** What the done message reads: the record's name, how much the live check saw, the share link when on. */
  doneFacts: (orgId: string, recordId: number) => Promise<DoneFacts | null>;
  /** Remember the post. */
  remember: (input: { orgId: string; channelId: string; ts: string; threadTs: string; text: string; announcedLabel: string; announcedUrl: string | null }) => Promise<void>;
};

const defaultDeps: SlackThreadFollowDeps = {
  async originConversation(orgId, recordId) {
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    const [row] = await db.select({ meta: businessObjectSchema.metadata, reviewActionRunId: businessObjectSchema.reviewActionRunId }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId))).limit(1);
    if (!row) {
      return null;
    }
    const { recordOrigin } = await import('@/services/objects/related');
    const origin = await recordOrigin(orgId, { id: recordId, meta: (row.meta ?? {}) as Record<string, unknown>, reviewActionRunId: row.reviewActionRunId });
    return origin?.conversationId ?? null;
  },
  async scopeOf(orgId, conversationId) {
    const { getConversation } = await import('@/services/ConversationService');
    const c = await getConversation({ orgId, id: conversationId });
    return c?.scopeRef ?? null;
  },
  async pageHref(orgId, typeSlug, recordId) {
    const base = appBaseUrl();
    if (!base) {
      return null;
    }
    try {
      const { recordHref: pageOf } = await import('@/services/objects/recordHref');
      return `${base}${await pageOf(orgId, { objectType: typeSlug, id: recordId })}`;
    } catch {
      return recordHref(recordId);
    }
  },
  async waitingCard(orgId, conversationId) {
    const { defaultThreadApprovalDeps } = await import('@/services/chat/slackApproval');
    const [card] = await defaultThreadApprovalDeps.pending(orgId, conversationId);
    if (!card) {
      return null;
    }
    const { getReviewDetail } = await import('@/services/ReviewService');
    const detail = await getReviewDetail(orgId, 'action', card.runId).catch(() => null);
    const shown = (detail?.card ?? null) as import('@/libs/actions/types').ReviewCard | null;
    const video = shown?.content?.find((c): c is Extract<import('@/libs/actions/types').ReviewContent, { kind: 'video' }> => c.kind === 'video') ?? null;
    return {
      runId: card.runId,
      title: shown?.title ?? card.title,
      verbs: { approve: shown?.verbs?.approve ?? 'Approve', reject: shown?.verbs?.reject ?? 'Reject' },
      video: video ? { url: video.url, caption: video.caption ?? video.label } : null,
    };
  },
  async alreadyPosted(channelId, threadTs, text) {
    const { ourPostsInThread } = await import('@/services/chat/slackPosts');
    return (await ourPostsInThread(channelId, threadTs)).some(p => p.text === text);
  },
  async post(ref, text) {
    const { postSlackReply } = await import('@/libs/surfaces/slack');
    const { tsOf } = await import('@/services/chat/slackPosts');
    const posted = await postSlackReply({ channelId: ref.channelId, threadRef: ref.threadTs }, text, process.env.SLACK_BOT_TOKEN);
    return posted ? tsOf(posted) || null : null;
  },
  async attach(orgId, ref, file) {
    const { readMediaBytes } = await import('@/libs/tools/artifacts/media');
    const media = await readMediaBytes(orgId, file.url);
    if (!media) {
      return false;
    }
    const { uploadSlackImages } = await import('@/libs/surfaces/slack');
    const up = await uploadSlackImages({ channelId: ref.channelId, threadRef: ref.threadTs, files: [{ filename: media.filename, title: file.caption, bytes: media.bytes }] }, process.env.SLACK_BOT_TOKEN);
    if (!up.ok) {
      console.warn('[slack-thread-follow] the demo was not uploaded', { channelId: ref.channelId, error: up.error });
    }
    return up.ok;
  },
  async captionOf(orgId, artifactId) {
    const { getArtifact } = await import('@/services/ArtifactService');
    const a = await getArtifact({ orgId, id: artifactId });
    const spec = (a?.spec ?? null) as Record<string, unknown> | null;
    const caption = typeof spec?.caption === 'string' && spec.caption.trim() ? spec.caption.trim() : null;
    return caption ?? a?.title?.trim() ?? null;
  },
  async alreadyAttached(channelId, threadTs, url) {
    const { ourPostsInThread } = await import('@/services/chat/slackPosts');
    return (await ourPostsInThread(channelId, threadTs)).some(p => p.announcedUrl === url);
  },
  async doneFacts(orgId, recordId) {
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    const [row] = await db.select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId))).limit(1);
    if (!row) {
      return null;
    }
    const mark = ((row.meta ?? {}) as Record<string, unknown>).liveCheck as { state?: string; lines?: Array<{ result?: string }> } | undefined;
    const lines = Array.isArray(mark?.lines) ? mark!.lines : [];
    const base = appBaseUrl();
    const { featureShareOf } = await import('@/services/factory/featureShareData');
    const share = base ? await featureShareOf(orgId, recordId).catch(() => null) : null;
    const live = mark?.state === 'seen' || mark?.state === 'partial' || mark?.state === 'not_seen' || mark?.state === 'not_checked' ? mark.state : null;
    return { title: row.title, live, reached: lines.filter(l => l.result === 'reached').length, total: lines.length, shareUrl: share?.shared && share.path ? `${base}${share.path}` : null };
  },
  async remember(input) {
    const { recordSlackPost } = await import('@/services/chat/slackPosts');
    await recordSlackPost({ orgId: input.orgId, channelId: input.channelId, ts: input.ts, threadTs: input.threadTs, kind: 'reply', text: input.text, announcedLabel: input.announcedLabel, announcedUrl: input.announcedUrl, createdBy: 'system:slack-thread-follow' });
  },
};

/**
 * Post one move of a record into the Slack thread it was asked in. Never
 * throws: a record with no Slack thread, a line already posted, or a missing
 * token each come back as the reason.
 * @param orgId - The workspace.
 * @param input - The `record.status_marked` payload.
 * @param deps - Seams for tests.
 */
export async function slackThreadFollow(orgId: string, input: Record<string, unknown>, deps: SlackThreadFollowDeps = defaultDeps): Promise<SlackThreadFollowResult> {
  const recordId = Number(input.recordId);
  const value = typeof input.value === 'string' ? input.value : '';
  if (!Number.isInteger(recordId) || recordId <= 0 || !value) {
    return { posted: false, reason: 'the event names no record or no status' };
  }
  const conversationId = await deps.originConversation(orgId, recordId);
  if (conversationId === null) {
    return { posted: false, reason: 'the record was not asked for in a conversation' };
  }
  const ref = slackThreadOfScope(await deps.scopeOf(orgId, conversationId));
  if (!ref) {
    return { posted: false, reason: 'the conversation is not a Slack thread' };
  }
  // THE THREAD HEARS WHAT MATTERS (Chris, 2026-10-05): what waits on a person — a question, the
  // merge card with its demo — and the end. The Work page carries every other move.
  const done = input.groupRole === 'done';
  if (input.needsYou !== true && !done) {
    return { posted: false, reason: 'a move the Work page carries, not the thread' };
  }
  const typeSlug = typeof input.typeSlug === 'string' && input.typeSlug ? input.typeSlug : null;
  const href = await deps.pageHref(orgId, typeSlug, recordId);
  const waiting = input.needsYou === true ? await deps.waitingCard(orgId, conversationId).catch(() => null) : null;
  let text: string;
  if (done) {
    const facts = await deps.doneFacts(orgId, recordId).catch(() => null);
    const line = facts ? doneText(facts, href) : null;
    if (!line) {
      return { posted: false, reason: 'done, but not yet seen on production' };
    }
    text = line;
  } else {
    text = followText({ line: typeof input.line === 'string' ? input.line : '', value }, href, waiting);
  }
  if (await deps.alreadyPosted(ref.channelId, ref.threadTs, text)) {
    return { posted: false, reason: 'already said in the thread' };
  }
  const ts = await deps.post(ref, text);
  await deps.remember({ orgId, channelId: ref.channelId, ts: ts ?? '', threadTs: ref.threadTs, text, announcedLabel: value, announcedUrl: href });
  // The evidence under the words: the card's demo, so the thread approves
  // something seen working. A failed upload leaves the words standing.
  const attached = waiting?.video ? await deps.attach(orgId, ref, waiting.video).catch(() => false) : false;
  return { posted: true, channelId: ref.channelId, threadTs: ref.threadTs, text, attached };
}

/**
 * The automation job: `do: { job: slack-thread-follow }` on `record.status_marked`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runSlackThreadFollowJob(orgId: string, input: Record<string, unknown>): Promise<SlackThreadFollowResult> {
  try {
    return await slackThreadFollow(orgId, input);
  } catch (err) {
    return { posted: false, reason: `the post failed: ${(err as Error).message}` };
  }
}

export type SlackThreadRecordingResult = { posted: number; attached: number; skipped: string[] };

/**
 * A RECORDING FILED ON A RECORD ASKED IN SLACK GOES INTO ITS THREAD (backlog
 * 057, gap 6: "seen live with the demo"). The production demo is recorded
 * after the live check and narrated after that, long after the last status
 * line; this carries it to the thread when it lands, once per thread: the
 * caption as the words, the file under them. Which roles reach the thread is
 * the plugin automation's filter (`when.filter.role`), never named here.
 * @param orgId - The workspace.
 * @param input - The `recording.filed` payload (`artifactId`, `url`, `recordIds`).
 * @param deps - Seams for tests.
 */
export async function slackThreadRecording(orgId: string, input: Record<string, unknown>, deps: SlackThreadFollowDeps = defaultDeps): Promise<SlackThreadRecordingResult> {
  const artifactId = Number(input.artifactId);
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const recordIds = [...new Set(String(input.recordIds ?? input.recordId ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))];
  const out: SlackThreadRecordingResult = { posted: 0, attached: 0, skipped: [] };
  if (!Number.isInteger(artifactId) || artifactId <= 0 || !url || recordIds.length === 0) {
    out.skipped.push('the event names no recording or no record');
    return out;
  }
  const seen = new Set<string>();
  for (const recordId of recordIds) {
    const conversationId = await deps.originConversation(orgId, recordId);
    const ref = conversationId === null ? null : slackThreadOfScope(await deps.scopeOf(orgId, conversationId));
    if (!ref) {
      out.skipped.push(`record ${recordId} was not asked in a Slack thread`);
      continue;
    }
    const key = `${ref.channelId}:${ref.threadTs}`;
    if (seen.has(key) || await deps.alreadyAttached(ref.channelId, ref.threadTs, url)) {
      out.skipped.push(`the thread for record ${recordId} already has it`);
      continue;
    }
    seen.add(key);
    const caption = (await deps.captionOf(orgId, artifactId).catch(() => null)) ?? 'A recording was filed.';
    const ts = await deps.post(ref, caption);
    await deps.remember({ orgId, channelId: ref.channelId, ts: ts ?? '', threadTs: ref.threadTs, text: caption, announcedLabel: typeof input.role === 'string' ? input.role : 'recording', announcedUrl: url });
    out.posted += 1;
    if (await deps.attach(orgId, ref, { url, caption }).catch(() => false)) {
      out.attached += 1;
    }
  }
  return out;
}

/**
 * The automation job: `do: { job: slack-thread-recording }` on `recording.filed`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runSlackThreadRecordingJob(orgId: string, input: Record<string, unknown>): Promise<SlackThreadRecordingResult> {
  try {
    return await slackThreadRecording(orgId, input);
  } catch (err) {
    return { posted: 0, attached: 0, skipped: [`the post failed: ${(err as Error).message}`] };
  }
}
