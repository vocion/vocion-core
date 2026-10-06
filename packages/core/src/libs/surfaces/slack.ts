import type { ChatImage, ChatImageFetcher, ChatInbound, ChatInboundFile, ChatMessage, ChatParse, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter, ChatVerification } from './types';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack as a chat surface. Events API in (`app_mention`, `message.im`,
 * `member_joined_channel` for the bot itself — never `message.channels` or
 * `message.groups`, which would stream every message in every channel),
 * `chat.postMessage` out, both over plain `fetch` like `libs/sources/slack.ts`
 * — no Slack SDK, by house precedent.
 *
 * Configuration is deployment-level for phase 1: one Slack app per Vocion
 * install, `SLACK_SIGNING_SECRET` + `SLACK_BOT_TOKEN` in the environment.
 * Per-org bot tokens through the credential vault are phase 2.
 */

/** Slack rejects replays older than five minutes; so do we. */
const MAX_SKEW_SECONDS = 300;

export const SLACK_API_BASE = 'https://slack.com/api';

type SlackEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  files?: { id?: string; name?: string; title?: string; mimetype?: string; size?: number; url_private?: string; url_private_download?: string }[];
};

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: SlackEvent;
  authorizations?: { user_id?: string; is_bot?: boolean }[];
};

/**
 * Slack's v0 signature: HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the
 * app's signing secret. Compared in constant time.
 * @param rawBody - The exact request body, unparsed.
 * @param headers - Request headers.
 * @param secret - The app's signing secret.
 * @param now - Clock, injectable for tests (seconds).
 */
export function verifySlackSignature(rawBody: string, headers: Headers, secret: string | undefined, now: number = Math.floor(Date.now() / 1000)): ChatVerification {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!ts || !sig) {
    return { ok: false, reason: 'missing_headers' };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/**
 * Strip `<@U…>` mentions (the bot's own, and any others) so the agent sees the
 * question, not the addressing.
 * @param text - Raw Slack message text.
 */
export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The bot's own Slack user id for this delivery. Slack stamps every
 * `event_callback` with the identities it was delivered for, so the envelope
 * usually answers this itself; `SLACK_BOT_USER_ID` is the fallback for the
 * events (and the tests) that carry no `authorizations` block.
 * @param env - The envelope.
 * @param configured - Deployment-configured bot user id, if any.
 */
function botUserIdFor(env: SlackEnvelope, configured?: string): string | undefined {
  const authed = env.authorizations?.find(a => a.is_bot && a.user_id)?.user_id;
  return authed ?? (configured || undefined);
}

/**
 * Classify an Events API envelope.
 * @param payload - Parsed JSON body.
 * @param configuredBotUserId - Bot user id from the environment, used when the
 * envelope carries no `authorizations` block.
 */
export function parseSlackPayload(payload: unknown, configuredBotUserId?: string): ChatParse {
  const env = (payload ?? {}) as SlackEnvelope;
  if (env.type === 'url_verification' && typeof env.challenge === 'string') {
    return { kind: 'challenge', challenge: env.challenge };
  }
  if (env.type !== 'event_callback' || !env.event) {
    return { kind: 'ignore', reason: `envelope type ${env.type ?? 'unknown'}` };
  }
  const ev = env.event;
  // The bot being added to a channel is the discovery signal, and it is the
  // one event with no `ts` and no human sender — so it is classified before
  // the message-shaped checks below, which would drop it as incomplete.
  if (ev.type === 'member_joined_channel') {
    const botUserId = botUserIdFor(env, configuredBotUserId);
    if (!ev.channel || !ev.user) {
      return { kind: 'ignore', reason: 'incomplete join event' };
    }
    if (!botUserId || ev.user !== botUserId) {
      return { kind: 'ignore', reason: 'another member joined' };
    }
    return { kind: 'joined', join: { surface: 'slack', teamId: env.team_id ?? null, channelId: ev.channel, botUserId } };
  }
  // A person pressed stop on an agent session: the turn working in that thread ends.
  if (ev.type === 'agent_session_stopped') {
    if (!ev.channel || !ev.thread_ts) {
      return { kind: 'ignore', reason: 'incomplete stop event' };
    }
    return { kind: 'stop', stop: { surface: 'slack', channelId: ev.channel, threadRef: ev.thread_ts, externalUserId: ev.user ?? null } };
  }
  if (ev.bot_id || ev.subtype) {
    return { kind: 'ignore', reason: ev.bot_id ? 'bot message' : `subtype ${ev.subtype}` };
  }
  if (!ev.user || !ev.channel || !ev.ts) {
    return { kind: 'ignore', reason: 'incomplete event' };
  }
  const isMention = ev.type === 'app_mention';
  const isDirect = ev.type === 'message' && ev.channel_type === 'im';
  // A reply in a channel thread with no mention: the handler answers it only in a thread Vocion is
  // already in. One that does mention the bot arrives again as `app_mention`, which answers it.
  const isFollowUp = ev.type === 'message' && !isDirect && Boolean(ev.thread_ts) && ev.thread_ts !== ev.ts;
  if (isFollowUp) {
    const botUserId = botUserIdFor(env, configuredBotUserId);
    if (!botUserId || (ev.text ?? '').includes(`<@${botUserId}>`)) {
      return { kind: 'ignore', reason: botUserId ? 'thread reply that mentions the bot (answered as app_mention)' : 'thread reply, bot user unknown' };
    }
  }
  if (!isMention && !isDirect && !isFollowUp) {
    return { kind: 'ignore', reason: `event type ${ev.type ?? 'unknown'}` };
  }
  const files = inboundFiles(ev.files);
  const text = stripMentions(ev.text ?? '');
  // A picture with no words is still a message (backlog 057: "@Vocion" and a screenshot), and so
  // is a bare "@Vocion" in a thread: the ask is the thread above it, picture and all (Chris,
  // 2026-10-05, the Slate loop). Only an empty direct message with nothing on it is noise.
  const bareThreadMention = isMention && Boolean(ev.thread_ts) && ev.thread_ts !== ev.ts;
  if (!text && files.length === 0 && !bareThreadMention) {
    return { kind: 'ignore', reason: 'empty text' };
  }
  const inbound: ChatInbound = {
    surface: 'slack',
    teamId: env.team_id ?? null,
    channelId: ev.channel,
    threadRef: ev.thread_ts ?? ev.ts,
    messageRef: ev.ts,
    externalUserId: ev.user,
    text: text || (files.length > 0 ? 'See the attached picture.' : 'See this thread.'),
    isDirect,
    ...(files.length > 0 ? { files } : {}),
    ...(isFollowUp ? { followUp: true } : {}),
  };
  return { kind: 'message', inbound };
}

/** Picture types the handler reads; anything else on the message is left in Slack. */
const INBOUND_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * The pictures on a Slack message, as the handler fetches them. Only images,
 * at most five, each with the private download address the bot's token opens.
 * @param files - Slack's `files` block.
 */
export function inboundFiles(files: SlackEvent['files']): ChatInboundFile[] {
  return (files ?? [])
    .filter(f => f && typeof f.mimetype === 'string' && INBOUND_IMAGE_TYPES.has(f.mimetype) && typeof (f.url_private_download ?? f.url_private) === 'string')
    .slice(0, 5)
    .map(f => ({ id: f.id ?? '', name: (f.title || f.name || 'picture').slice(0, 120), contentType: f.mimetype!, bytes: typeof f.size === 'number' ? f.size : 0, url: (f.url_private_download ?? f.url_private)! }));
}

/**
 * The bytes of a picture Slack holds, with the bot's token. Null when there is
 * no token, Slack refuses, or the body is not an image.
 * @param url - The file's private address.
 * @param token - The bot token.
 * @param fetchImpl - The network, injectable in tests.
 */
export async function fetchSlackFile(url: string, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!token) {
    return null;
  }
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'follow' }).catch(() => null);
  if (!res || !res.ok) {
    return null;
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!INBOUND_IMAGE_TYPES.has(contentType)) {
    return null;
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
}

/* ------------------------------------------------------------------ */
/* Posting — text, and the media ladder                                 */
/* ------------------------------------------------------------------ */

/**
 * How images reached the channel, in the order we prefer them.
 *
 * - `uploaded` — the bytes live in Slack (`files:write`). Works for an image
 *   behind our own auth, because we read it server-side and hand over bytes.
 * - `blocks` — a Block Kit `image` block pointing at a publicly reachable URL.
 *   Slack fetches it itself and renders it INLINE with only `chat:write`.
 * - `unreachable` — neither: the scope is missing AND the URL needs a sign-in,
 *   so the post says so rather than showing a broken picture.
 * - `none` — the message carried no images.
 *
 * A bare link is not on the ladder. Verified on the live app 2026-09-15: a
 * link to an image in a private channel does NOT unfurl even with
 * `unfurl_media: true`, so "paste the link" is a picture nobody sees.
 */
export type SlackMedia = 'none' | 'uploaded' | 'blocks' | 'unreachable';

/**
 * Slack rejects an `image` block whose URL it cannot fetch itself.
 * @param url
 */
export function isPubliclyFetchable(url: string): boolean {
  return /^https:\/\//i.test(url) && !url.includes('/api/artifacts/');
}

/**
 * The message as blocks. The caption goes in `alt_text` and in a `section`
 * block above the image — Slack IGNORES `title` on an image block inside a
 * message and warns `ignored_extra_attributes_for_image_block`, so a caption
 * put there is a caption nobody reads.
 *
 * `text` stays on the payload alongside the blocks: it is what a notification
 * and a screen reader get when the blocks do not render.
 * @param text - The message body.
 * @param images - Images to render inline. Only publicly fetchable URLs belong here.
 */
export function slackBlocks(text: string, images: ChatImage[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  if (text.trim()) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  }
  for (const img of images) {
    const caption = img.caption.trim();
    if (caption) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: caption } });
    }
    blocks.push({ type: 'image', image_url: img.url, alt_text: caption || 'screenshot' });
  }
  return blocks;
}

/**
 * A message given as a bare string or as an object, normalised.
 * @param message
 */
function asMessage(message: string | ChatMessage): ChatMessage {
  return typeof message === 'string' ? { text: message } : message;
}

/** The most text one `markdown` block carries. */
const SLACK_MARKDOWN_MAX = 12_000;

/**
 * Slack Web API methods that accept only form arguments: the reads, and
 * `files.getUploadURLExternal`, which answered every JSON call with "missing
 * required field: filename", so no file Vocion uploaded ever reached Slack —
 * every announcement's screenshot fell back to a link (walk 26, 2026-10-06).
 */
const SLACK_READ_METHODS = ['conversations.', 'users.', 'files.info', 'files.getUploadURLExternal', 'chat.getPermalink', 'auth.', 'team.', 'bots.'];

/**
 * Whether a Slack method reads (form arguments only) rather than writes (JSON accepted).
 * @param method - The Web API method, `conversations.replies`.
 */
export function isSlackRead(method: string): boolean {
  return SLACK_READ_METHODS.some(prefix => method.startsWith(prefix));
}

/**
 * One Slack Web API call, with the two-layer error check (`res.ok` and
 * `body.ok`) the source connector already uses. `missing_scope` is returned
 * rather than thrown: a missing scope is a fact about the install to degrade
 * on, not a bug to crash on.
 * @param method - API method name, e.g. `chat.postMessage`.
 * @param body - JSON payload.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function slackApi<T extends Record<string, unknown>>(method: string, body: Record<string, unknown>, token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  if (!token) {
    return { ok: false, error: 'missing_token' };
  }
  // Slack's read methods (conversations.replies, conversations.info, users.info…) take form
  // arguments only: a JSON body reads as "missing required field: channel" (2026-10-05, every
  // thread read since the surface shipped). Reads go as a form; writes keep JSON, which they accept.
  const res = await fetchImpl(`${baseUrl}/${method}`, isSlackRead(method)
    ? {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.entries(body).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])).toString(),
      }
    : {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }
  const parsed = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!parsed.ok) {
    return { ok: false, error: parsed.error ?? 'unknown' };
  }
  return { ok: true, body: parsed };
}

/**
 * Upload images into Slack as real files (`files:write`): ask for an upload
 * URL, PUT the bytes, then complete the upload into the channel and thread.
 * Three calls per file, which is what Slack's current API costs — `files.upload`
 * is retired.
 *
 * Bytes come from the caller, not from Slack fetching a URL, which is exactly
 * why this rung works for an image behind our own authentication.
 * @param opts - Channel, thread, the comment the files arrive under, and the files.
 * @param opts.channelId
 * @param opts.threadRef
 * @param opts.initialComment
 * @param opts.files
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 * @returns The ids Slack assigned, or the API error that stopped it.
 */
export async function uploadSlackImages(
  opts: { channelId: string; threadRef?: string; initialComment?: string; files: { filename: string; title: string; bytes: Uint8Array }[] },
  token: string | undefined,
  baseUrl = SLACK_API_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; fileIds: string[] } | { ok: false; error: string }> {
  const fileIds: { id: string; title: string }[] = [];
  for (const file of opts.files) {
    const handle = await slackApi<{ upload_url?: string; file_id?: string }>(
      'files.getUploadURLExternal',
      { filename: file.filename, length: file.bytes.byteLength },
      token,
      baseUrl,
      fetchImpl,
    );
    if (!handle.ok) {
      return { ok: false, error: handle.error };
    }
    const { upload_url: uploadUrl, file_id: fileId } = handle.body;
    if (!uploadUrl || !fileId) {
      return { ok: false, error: 'upload_url_missing' };
    }
    const put = await fetchImpl(uploadUrl, { method: 'POST', body: file.bytes as BodyInit });
    if (!put.ok) {
      return { ok: false, error: `upload_http_${put.status}` };
    }
    fileIds.push({ id: fileId, title: file.title });
  }
  const complete = await slackApi(
    'files.completeUploadExternal',
    {
      files: fileIds.map(f => ({ id: f.id, title: f.title })),
      channel_id: opts.channelId,
      ...(opts.threadRef ? { thread_ts: opts.threadRef } : {}),
      ...(opts.initialComment ? { initial_comment: opts.initialComment } : {}),
    },
    token,
    baseUrl,
    fetchImpl,
  );
  if (!complete.ok) {
    return { ok: false, error: complete.error };
  }
  return { ok: true, fileIds: fileIds.map(f => f.id) };
}

/** Fetch the bytes behind an image so the upload rung can hand them to Slack. */
export type ImageFetcher = ChatImageFetcher;

/**
 * Post a message into the thread, carrying its images the best way the
 * install's scopes allow (see {@link SlackMedia}).
 *
 * A target that carries a persona is posted with Slack's `username` and
 * `icon_url` overrides, which need the `chat:write.customize` bot scope — one
 * app, N faces. Without a persona the payload is byte-identical to what it was
 * before personas existed: the keys are omitted, never sent as null, because
 * Slack treats an explicit empty `username` as a name and posts blank.
 * A target with no `threadRef` posts to the channel itself rather than into a
 * thread — the channel-join introduction, which has no thread to answer in.
 * @param target - Channel, optionally a thread, and optionally the persona to post as.
 * @param message - Plain text (Slack mrkdwn is fine), or `{ text, images }`.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param opts - Scope and byte-fetching seams, injectable for tests.
 * @param opts.scopes - Bot scopes this install holds; omitted means "ask Slack".
 * @param opts.fetchImage - Reads the bytes behind an image, for the upload rung.
 * @param opts.fetchImpl - Injectable fetch.
 */
export async function postSlackReply(
  target: ChatReplyTarget,
  message: string | ChatMessage,
  token: string | undefined,
  baseUrl = SLACK_API_BASE,
  opts: { scopes?: ReadonlySet<string>; fetchImage?: ImageFetcher; fetchImpl?: typeof fetch } = {},
): Promise<ChatPostRef | null> {
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set; cannot reply');
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const msg = asMessage(message);
  const images = msg.images ?? [];
  let media: SlackMedia = 'none';
  let text = msg.text;
  let renderable: ChatImage[] = [];

  if (images.length > 0) {
    const scopes = opts.scopes ?? await fetchBotScopes(token, baseUrl, fetchImpl);
    if (scopes.has('files:write') && opts.fetchImage) {
      const files: { filename: string; title: string; bytes: Uint8Array }[] = [];
      for (const [i, image] of images.entries()) {
        const bytes = await opts.fetchImage(image).catch(() => null);
        if (bytes) {
          files.push({ filename: filenameFor(image, i), title: image.caption || `image ${i + 1}`, bytes });
        }
      }
      if (files.length === images.length) {
        const uploaded = await uploadSlackImages({ channelId: target.channelId, threadRef: target.threadRef, initialComment: text, files }, token, baseUrl, fetchImpl);
        if (uploaded.ok) {
          // completeUploadExternal posts the message; there is no separate
          // chat.postMessage, and no `ts` to key an outbound record on.
          return { channelId: target.channelId, ts: '', ...(target.threadRef ? { threadRef: target.threadRef } : {}), media: 'uploaded', fileIds: uploaded.fileIds };
        }
      }
      // Fell through: a byte read or the upload failed. The block rung below
      // still shows the images, so this is a downgrade, not a failure.
    }
    renderable = images.filter(i => isPubliclyFetchable(i.url));
    const unreachable = images.filter(i => !isPubliclyFetchable(i.url));
    media = renderable.length > 0 ? 'blocks' : 'unreachable';
    if (unreachable.length > 0) {
      // Honest rather than broken: an image block pointing at a URL Slack
      // cannot fetch renders as a grey box, and a bare link does not unfurl.
      text = `${text}\n\n${unreachable.map(i => `_${i.caption || 'image'} — ${i.url} (opens in Vocion; sign-in required, so Slack cannot show it inline)_`).join('\n')}`;
    }
  }

  const payload: Record<string, unknown> = { channel: target.channelId, text };
  if (target.threadRef) {
    payload.thread_ts = target.threadRef;
  }
  if (target.displayName) {
    payload.username = target.displayName;
  }
  if (target.iconUrl) {
    payload.icon_url = target.iconUrl;
  }
  if (renderable.length > 0) {
    payload.blocks = slackBlocks(text, renderable);
  } else if (text.length <= SLACK_MARKDOWN_MAX) {
    // Agents write standard Markdown; Slack's `markdown` block renders it as written (bold, lists,
    // links), where plain `text` shows the asterisks. The words are not touched; `text` stays as
    // the notification fallback.
    payload.blocks = [{ type: 'markdown', text }];
  }
  const posted = await slackApi<{ ts?: string; channel?: string }>('chat.postMessage', payload, token, baseUrl, fetchImpl);
  if (!posted.ok) {
    throw new Error(`Slack chat.postMessage failed: ${posted.error}`);
  }
  return {
    channelId: posted.body.channel ?? target.channelId,
    ts: posted.body.ts ?? '',
    ...(target.threadRef ? { threadRef: target.threadRef } : {}),
    media,
  };
}

/**
 * A filename Slack will accept, derived from the image URL or its position.
 * @param image
 * @param index
 */
function filenameFor(image: ChatImage, index: number): string {
  const last = image.filename ?? image.url.split(/[?#]/)[0]!.split('/').pop() ?? '';
  return /\.(?:png|jpe?g|gif|webp|mp4|webm|mov)$/i.test(last) ? last : `screenshot-${index + 1}.png`;
}

/**
 * Post an announcement — a release note, a report — into a channel, carrying
 * its screenshots.
 *
 * Same ladder as a reply, and the reason it exists: the original post is where
 * the screenshots belong. A reader who has to ask "any screenshots to go with
 * this?" is reading an announcement that was built without them.
 * @param target - Channel and optional persona. A `threadRef` posts into an existing thread.
 * @param message - Text and images.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param opts - Scope and byte-fetching seams, injectable for tests.
 * @param opts.scopes
 * @param opts.fetchImage
 * @param opts.fetchImpl
 */
export async function postAnnouncement(
  target: ChatReplyTarget,
  message: ChatMessage,
  token: string | undefined,
  baseUrl = SLACK_API_BASE,
  opts: { scopes?: ReadonlySet<string>; fetchImage?: ImageFetcher; fetchImpl?: typeof fetch } = {},
): Promise<ChatPostRef | null> {
  return postSlackReply(target, message, token, baseUrl, opts);
}

/**
 * Take a post back: `chat.delete` for a message Slack gave a `ts` for, and
 * `files.delete` for each file an upload created (an upload posts the message
 * itself, so its files are its handle). The undo of a published announcement.
 * `message_not_found` / `file_not_found` count as done: someone already
 * removed it in Slack, which is what undo was for.
 * @param post - Where it landed and what it created.
 * @param post.channelId - The channel.
 * @param post.ts - The message's Slack id, when there is one.
 * @param post.fileIds - The uploaded files, when there are any.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function deleteSlackPost(
  post: { channelId: string; ts?: string | null; fileIds?: string[] | null },
  token: string | undefined,
  baseUrl = SLACK_API_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gone = new Set(['message_not_found', 'file_not_found', 'file_deleted']);
  if (post.ts) {
    const res = await slackApi('chat.delete', { channel: post.channelId, ts: post.ts }, token, baseUrl, fetchImpl);
    if (!res.ok && !gone.has(res.error)) {
      return res;
    }
  }
  for (const file of post.fileIds ?? []) {
    const res = await slackApi('files.delete', { file }, token, baseUrl, fetchImpl);
    if (!res.ok && !gone.has(res.error)) {
      return res;
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Scopes — what this install can actually do                          */
/* ------------------------------------------------------------------ */

const SCOPE_TTL_MS = 5 * 60 * 1000;
const scopeCache = new Map<string, { scopes: Set<string>; at: number }>();

/**
 * The bot scopes this install holds, read from `auth.test`'s `x-oauth-scopes`
 * response header. Cached per token for the process's lifetime minus a short
 * TTL, because a reinstall changes them and nothing tells us.
 *
 * Asked rather than configured: a scope list in the environment is a list of
 * what someone MEANT to grant. The live app's answer is what it can do.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function fetchBotScopes(token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  if (!token) {
    return new Set();
  }
  const cached = scopeCache.get(token);
  if (cached && Date.now() - cached.at < SCOPE_TTL_MS) {
    return cached.scopes;
  }
  try {
    const res = await fetchImpl(`${baseUrl}/auth.test`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const header = res.headers.get('x-oauth-scopes') ?? '';
    const scopes = new Set(header.split(',').map(s => s.trim()).filter(Boolean));
    scopeCache.set(token, { scopes, at: Date.now() });
    return scopes;
  } catch {
    return new Set();
  }
}

/** Clear the scope cache — a reinstall, and the tests. */
export function resetSlackScopeCache(): void {
  scopeCache.clear();
}

export const slackSurface: ChatSurfaceAdapter = {
  id: 'slack',
  verify: (rawBody, headers) => verifySlackSignature(rawBody, headers, process.env.SLACK_SIGNING_SECRET),
  parse: payload => parseSlackPayload(payload, process.env.SLACK_BOT_USER_ID),
  reply: (target, message, opts) => postSlackReply(target, message, process.env.SLACK_BOT_TOKEN, SLACK_API_BASE, opts?.fetchImage ? { fetchImage: opts.fetchImage } : {}),
  retract: async (post) => {
    await deleteSlackPost(post, process.env.SLACK_BOT_TOKEN);
  },
  session: async (target, state) => {
    if (!target.threadRef) {
      return false;
    }
    const r = await slackApi('agents.sessions.setStatus', { channel_id: target.channelId, thread_ts: target.threadRef, status: state === 'working' ? 'processing' : 'active' }, process.env.SLACK_BOT_TOKEN);
    return r.ok;
  },
  edit: async (post, text) => {
    if (!post.ts) {
      return;
    }
    // The working line went up as a markdown block (`postSlackReply`); the block is what Slack draws.
    await slackApi('chat.update', { channel: post.channelId, ts: post.ts, text, blocks: [{ type: 'markdown', text }] }, process.env.SLACK_BOT_TOKEN);
  },
};
