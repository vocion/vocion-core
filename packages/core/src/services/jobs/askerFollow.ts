/**
 * THE ASKER HEARS BACK WHERE THEY ASKED (Chris, 2026-10-06: "update me if it was blocked, update
 * me if … a required human in the loop approval to merge … I should expect my next update when
 * it's in production and ready to review inside that same thread").
 *
 * One job for every conversation a request was asked in, the app's chat or a Slack thread alike:
 * a record's status move (`record.status_marked`) carries what its type says to tell the asker
 * for that transition (`x-tell`), and this fills it in, adds the feature page (and the share link
 * when it is done, and how to decide when a card waits) and hands it to `tellConversation`, which
 * says it once in the conversation and in its thread. A transition the type does not name is not
 * said. Nothing here names a type or a status.
 *
 * Replaced the two jobs that did half each (`conversation-follow` for the app's chat,
 * `slack-thread-follow` for threads), which kept their own once-only rules and words, and posted
 * for a send-back that needed nobody.
 */
import type { TellFile, TellResult } from '@/services/chat/tellConversation';
import { appBaseUrl } from '@/libs/links';

export const ASKER_FOLLOW_JOB = 'asker-follow';
/** The job that carries a filed recording into the thread (`recording.filed`, filtered by the plugin to the roles it wants there). */
export const ASKER_RECORDING_JOB = 'slack-thread-recording';
/** Retired ids, answered with nothing so a workspace whose old automation still names them does not say a line twice. */
export const RETIRED_FOLLOW_JOBS = ['conversation-follow', 'slack-thread-follow'] as const;

/** The card waiting on a person for this record, as the line shows it. */
export type WaitingCard = { verbs: { approve: string; reject: string }; video: { url: string; caption: string } | null; mockups?: TellFile[] };

/** The record as the line reads it. */
export type AskedRecord = {
  /** The conversations to tell: the one it was asked in, then the ones that acted on it since (`objects/followers.ts`). */
  conversationIds: number[];
  title: string;
  reopenedAt: string | null;
};

export type AskerFollowDeps = {
  record: (orgId: string, recordId: number) => Promise<AskedRecord | null>;
  pageHref: (orgId: string, typeSlug: string | null, recordId: number) => Promise<string | null>;
  shareUrl: (orgId: string, recordId: number) => Promise<string | null>;
  /** The card waiting on a person here: one this conversation filed, or one about this record. */
  waitingCard: (orgId: string, conversationId: number, recordId: number) => Promise<WaitingCard | null>;
  tell: (orgId: string, conversationId: number, text: string, opts: { key: string; files?: TellFile[]; threadOnly?: boolean; url?: string | null }) => Promise<TellResult>;
  markTold: (orgId: string, recordId: number, told: { at: string; channel: string; what: string; status: string }) => Promise<void>;
  captionOf: (orgId: string, artifactId: number) => Promise<string | null>;
};

/**
 * The line for one move: the type's words with the step's sentence and the record's name in
 * them, how to decide when a card waits, then the feature page and, when done, the share link.
 * @param template - The type's `x-tell` entry.
 * @param fill - The step's sentence and the record's title.
 * @param fill.line
 * @param fill.title
 * @param links - The page, the share link and the waiting card.
 * @param links.href
 * @param links.shareUrl
 * @param links.waiting
 */
export function askerLine(template: string, fill: { line: string; title: string }, links: { href: string | null; shareUrl: string | null; waiting: WaitingCard | null }): string {
  const sentence = fill.line.trim() ? (/[.!?…]$/.test(fill.line.trim()) ? fill.line.trim() : `${fill.line.trim()}.`) : '';
  const said = template.replace(/\{line\}/g, sentence).replace(/\{title\}/g, fill.title).replace(/\s+$/, '').replace(/ {2,}/g, ' ');
  const decide = links.waiting ? `${links.waiting.verbs.approve} or ${links.waiting.verbs.reject}: reply here, or decide it in Vocion.` : null;
  return [said, decide, links.href ? `Feature page: ${links.href}` : null, links.shareUrl ? `Share it: ${links.shareUrl}` : null].filter((s): s is string => Boolean(s)).join('\n');
}

/**
 * Once per moment: a status said again in the same words is the same moment (an event fired
 * twice); a finished status is said once until the record is reopened, whatever its sentence.
 * @param recordId - The record.
 * @param value - The status.
 * @param groupRole - Its group's role.
 * @param line - The step's sentence.
 * @param reopenedAt - When a person last reopened it.
 */
export function askerKey(recordId: number, value: string, groupRole: string, line: string, reopenedAt: string | null): string {
  if (groupRole === 'done') {
    return `record:${recordId}:${value}:${reopenedAt ?? 'first'}`;
  }
  let h = 0;
  for (const ch of line) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return `record:${recordId}:${value}:${(h >>> 0).toString(36)}`;
}

export type AskerFollowResult = { said: true; channel: 'chat' | 'slack'; text: string; told: boolean } | { said: false; reason: string };

const defaultDeps: AskerFollowDeps = {
  async record(orgId, recordId) {
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    const [row] = await db.select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata, reviewActionRunId: businessObjectSchema.reviewActionRunId }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId))).limit(1);
    if (!row) {
      return null;
    }
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const { recordOrigin } = await import('@/services/objects/related');
    const origin = await recordOrigin(orgId, { id: recordId, meta, reviewActionRunId: row.reviewActionRunId });
    const { followersOf } = await import('@/services/objects/followers');
    const conversationIds = [...new Set([...(origin?.conversationId ? [origin.conversationId] : []), ...followersOf(meta)])];
    return { conversationIds, title: row.title, reopenedAt: typeof meta.reopenedAt === 'string' && meta.reopenedAt ? meta.reopenedAt : null };
  },
  async pageHref(orgId, typeSlug, recordId) {
    const base = appBaseUrl();
    if (!base) {
      return null;
    }
    try {
      const { recordHref } = await import('@/services/objects/recordHref');
      return `${base}${await recordHref(orgId, { objectType: typeSlug, id: recordId })}`;
    } catch {
      return `${base}/dashboard/objects/${recordId}`;
    }
  },
  async shareUrl(orgId, recordId) {
    const base = appBaseUrl();
    if (!base) {
      return null;
    }
    const { featureShareOf } = await import('@/services/factory/featureShareData');
    const state = await featureShareOf(orgId, recordId).catch(() => null);
    return state?.shared && state.path ? `${base}${state.path}` : null;
  },
  async waitingCard(orgId, conversationId, recordId) {
    const { defaultThreadApprovalDeps } = await import('@/services/chat/slackApproval');
    const [card] = await defaultThreadApprovalDeps.pending(orgId, conversationId, recordId);
    if (!card) {
      return null;
    }
    const { getReviewDetail } = await import('@/services/ReviewService');
    const detail = await getReviewDetail(orgId, 'action', card.runId).catch(() => null);
    const shown = (detail?.card ?? null) as import('@/libs/actions/types').ReviewCard | null;
    const video = shown?.content?.find((c): c is Extract<import('@/libs/actions/types').ReviewContent, { kind: 'video' }> => c.kind === 'video') ?? null;
    const { cardMockups } = await import('@/services/chat/cardPictures');
    const mockups = await cardMockups(orgId, card.input).catch(() => []);
    return { verbs: { approve: shown?.verbs?.approve ?? 'Approve', reject: shown?.verbs?.reject ?? 'Reject' }, video: video ? { url: video.url, caption: video.caption ?? video.label } : null, mockups };
  },
  async tell(orgId, conversationId, text, opts) {
    const { tellConversation } = await import('@/services/chat/tellConversation');
    return tellConversation(orgId, conversationId, text, opts);
  },
  async markTold(orgId, recordId, told) {
    const { writeMeta } = await import('@/libs/actions/factory-dispatch');
    await writeMeta(orgId, recordId, { told });
  },
  async captionOf(orgId, artifactId) {
    const { getArtifact } = await import('@/services/ArtifactService');
    const a = await getArtifact({ orgId, id: artifactId });
    const spec = (a?.spec ?? null) as Record<string, unknown> | null;
    const caption = typeof spec?.caption === 'string' && spec.caption.trim() ? spec.caption.trim() : null;
    return caption ?? a?.title?.trim() ?? null;
  },
};

/**
 * Tell the asker one move of a record, where they asked. Never throws.
 * @param orgId - The workspace.
 * @param input - The `record.status_marked` payload.
 * @param deps - Seams for tests.
 */
export async function askerFollow(orgId: string, input: Record<string, unknown>, deps: AskerFollowDeps = defaultDeps): Promise<AskerFollowResult> {
  const recordId = Number(input.recordId);
  const value = typeof input.value === 'string' ? input.value : '';
  const template = typeof input.tell === 'string' ? input.tell.trim() : '';
  if (!Number.isInteger(recordId) || recordId <= 0 || !value) {
    return { said: false, reason: 'the event names no record or no status' };
  }
  if (!template) {
    return { said: false, reason: 'the type tells the asker nothing for this move' };
  }
  const record = await deps.record(orgId, recordId);
  if (!record || record.conversationIds.length === 0) {
    return { said: false, reason: 'the record was not asked for in a conversation' };
  }
  const groupRole = typeof input.groupRole === 'string' ? input.groupRole : '';
  const done = groupRole === 'done';
  const typeSlug = typeof input.typeSlug === 'string' && input.typeSlug ? input.typeSlug : null;
  const line = typeof input.line === 'string' ? input.line : '';
  const [href, shareUrl] = await Promise.all([
    deps.pageHref(orgId, typeSlug, recordId),
    done ? deps.shareUrl(orgId, recordId) : Promise.resolve(null),
  ]);
  // Every conversation that asked or acted hears it once, each with how to decide from there.
  let first: { channel: 'chat' | 'slack'; text: string } | null = null;
  const reasons: string[] = [];
  for (const conversationId of record.conversationIds) {
    const waiting = input.needsYou === true ? await deps.waitingCard(orgId, conversationId, recordId).catch(() => null) : null;
    const text = askerLine(template, { line, title: record.title }, { href, shareUrl, waiting });
    // The card's demo and the request's mockups go up under the words, so the thread approves
    // something seen working against what was drawn.
    const files: TellFile[] = [...(waiting?.video ? [waiting.video] : []), ...(waiting?.mockups ?? [])];
    const told = await deps.tell(orgId, conversationId, text, { key: askerKey(recordId, value, groupRole, line, record.reopenedAt), files, url: href });
    if (told.said) {
      first ??= { channel: told.channel, text };
    } else {
      reasons.push(told.reason);
    }
  }
  if (!first) {
    return { said: false, reason: reasons[0] ?? 'nothing was said' };
  }
  if (done) {
    const at = typeof input.at === 'string' && input.at ? input.at : new Date().toISOString();
    await deps.markTold(orgId, recordId, { at, channel: first.channel, what: first.text, status: 'sent' }).catch(() => undefined);
  }
  return { said: true, channel: first.channel, text: first.text, told: done };
}

/**
 * The automation job: `do: { job: asker-follow }` on `record.status_marked`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runAskerFollowJob(orgId: string, input: Record<string, unknown>): Promise<AskerFollowResult> {
  try {
    return await askerFollow(orgId, input);
  } catch (err) {
    return { said: false, reason: `not said: ${(err as Error).message}` };
  }
}

export type AskerRecordingResult = { posted: number; skipped: string[] };

/**
 * A RECORDING FILED ON A RECORD ASKED IN SLACK GOES INTO ITS THREAD (backlog 057, gap 6: "seen
 * live with the demo"). The production demo lands after the last status line; this carries it to
 * the thread, once per thread: the caption as the words, the file under them. Which roles reach
 * the thread is the plugin automation's filter (`when.filter.role`), never named here.
 * @param orgId - The workspace.
 * @param input - The `recording.filed` payload (`artifactId`, `url`, `recordIds`).
 * @param deps - Seams for tests.
 */
export async function askerRecording(orgId: string, input: Record<string, unknown>, deps: AskerFollowDeps = defaultDeps): Promise<AskerRecordingResult> {
  const artifactId = Number(input.artifactId);
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const recordIds = [...new Set(String(input.recordIds ?? input.recordId ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))];
  const out: AskerRecordingResult = { posted: 0, skipped: [] };
  if (!Number.isInteger(artifactId) || artifactId <= 0 || !url || recordIds.length === 0) {
    out.skipped.push('the event names no recording or no record');
    return out;
  }
  const seen = new Set<number>();
  for (const recordId of recordIds) {
    const record = await deps.record(orgId, recordId);
    const fresh = (record?.conversationIds ?? []).filter(c => !seen.has(c));
    if (fresh.length === 0) {
      out.skipped.push(`record ${recordId} has no conversation of its own to tell`);
      continue;
    }
    const caption = (await deps.captionOf(orgId, artifactId).catch(() => null)) ?? 'A recording was filed.';
    for (const conversationId of fresh) {
      seen.add(conversationId);
      const told = await deps.tell(orgId, conversationId, caption, { key: `recording:${url}`, files: [{ url, caption, artifactId }], threadOnly: true, url });
      if (told.said) {
        out.posted += 1;
      } else {
        out.skipped.push(`record ${recordId}: ${told.reason}`);
      }
    }
  }
  return out;
}

/**
 * The automation job: `do: { job: slack-thread-recording }` on `recording.filed`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runAskerRecordingJob(orgId: string, input: Record<string, unknown>): Promise<AskerRecordingResult> {
  try {
    return await askerRecording(orgId, input);
  } catch (err) {
    return { posted: 0, skipped: [`not posted: ${(err as Error).message}`] };
  }
}
