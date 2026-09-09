/**
 * Chat surfaces — the seam between a messaging platform and the agent runtime
 * (approval item 025, phase 1). Everything platform-specific lives behind this
 * interface: request verification, event parsing, and how a reply is posted.
 * Everything downstream — binding a channel to an agent, the conversation,
 * the agent run, the review queue — never sees a platform type.
 *
 * Fourth instance of a house pattern (source connectors, actions, platforms),
 * kept from the first commit with one implementation so the runtime does not
 * grow Slack-shaped assumptions that a Teams adapter would have to unpick.
 */

/** A message a person sent to an agent through a chat surface, normalised. */
export type ChatInbound = {
  surface: string;
  /** The platform's workspace/tenant id (Slack `team_id`), when it has one. */
  teamId: string | null;
  channelId: string;
  /** Thread key — replies go here and the conversation is scoped to it. */
  threadRef: string;
  /** This message's own id, for logging. */
  messageRef: string;
  /** The platform's user id. An EXTERNAL identity: it never authorises anything. */
  externalUserId: string;
  /** Message text with the bot mention stripped. */
  text: string;
  isDirect: boolean;
};

export type ChatVerification
  = | { ok: true }
    | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'stale' | 'bad_signature' };

export type ChatParse
  = | { kind: 'challenge'; challenge: string }
    | { kind: 'message'; inbound: ChatInbound }
    | { kind: 'ignore'; reason: string };

export type ChatSurfaceAdapter = {
  id: string;
  /** Verify the platform's request signature against the raw body. */
  verify: (rawBody: string, headers: Headers) => ChatVerification;
  /** Turn a parsed JSON payload into a challenge, a message, or a reason to ignore it. */
  parse: (payload: unknown) => ChatParse;
  /** Post a plain-text reply into the thread. */
  reply: (target: { channelId: string; threadRef: string }, text: string) => Promise<void>;
};
