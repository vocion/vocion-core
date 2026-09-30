/**
 * THE LIVE STREAM'S VOCABULARY (backlog 050) — shared by the server that
 * publishes and checks topics and the browser that follows them.
 *
 * A notice says WHAT changed, never the change: a browser that hears one
 * re-reads through the typed read it already uses, so shape and permission
 * live in one place. A topic is `<noun>:<id>` for one thing or a bare noun
 * for a workspace feed; the nouns are the ones the product already has.
 *
 * | topic | what publishes it |
 * |---|---|
 * | `record:<id>` | a `business_object` row; a worker run for it (`input.record`); an artifact that belongs to it |
 * | `list:<type slug>` | any record of that type — the slug is read off the record's type row, never written in core |
 * | `card:<id>`, `cards` | an `action_run` (a card, a proposal) |
 * | `run:<id>`, `runs` | a `worker_run`; an agent run joins `runs` too |
 * | `mission:<id>` | a `mission_run` (an agent run) |
 * | `ask:<id>`, `asks` | an `ask` |
 * | `artifact:<id>` | an `artifact` (a new head version moves its row) |
 * | `events` | every event emitted (`event_log`) |
 * | `notification:<userId>` | a notification for that person (`publish()`); only that person may follow it |
 *
 * The first eight are published by triggers (migration 0155); anything else
 * goes through `publish()` in `libs/live/publish.ts`.
 */

/** A change notice as a follower receives it. */
export type LiveNotice = {
  /** The ring's id — what `Last-Event-ID` resumes from. */
  id: number;
  /** Every topic the change concerns; a follower hears it on any one of them. */
  topics: string[];
  /** What changed, as `<noun>:<id>` — `record:12`, `card:7`, `event:88`. */
  ref: string;
  /**
   * How: `created`, `changed`, `deleted`, an event's type for `events`, or
   * `resync` when the stream could not replay what a follower missed and it
   * should read everything it shows again.
   */
  kind: string;
  /** ISO — when it was written. */
  at: string;
};

/** Nouns that name one thing by id. */
const ONE = ['record', 'card', 'run', 'mission', 'ask', 'artifact'] as const;
/** Nouns that are a whole workspace feed. */
const FEEDS = ['cards', 'runs', 'asks', 'events'] as const;

export type LiveOneNoun = (typeof ONE)[number];
export type LiveFeed = (typeof FEEDS)[number];

/** A parsed topic. */
export type LiveTopic
  = | { kind: LiveOneNoun; id: number; topic: string }
    | { kind: 'list'; slug: string; topic: string }
    | { kind: 'feed'; feed: LiveFeed; topic: string }
    | { kind: 'notification'; userId: string; topic: string };

/**
 * The most topics one connection follows — every follower on a tab shares
 * one, so this is the tab's budget, not a component's. A surface that would
 * need more follows a feed.
 */
export const MAX_LIVE_TOPICS = 400;

const ID = /^[1-9]\d{0,17}$/;
const SLUG = /^[\w-]{1,80}$/;
const USER = /^[\w.@:-]{1,128}$/;

/**
 * Read one topic, or null when it is not one this stream publishes. The
 * grammar is closed: a topic nothing publishes is a typo, and following it
 * would wait forever in silence.
 * @param raw - The topic as written.
 */
export function parseTopic(raw: string): LiveTopic | null {
  const topic = raw.trim();
  if ((FEEDS as readonly string[]).includes(topic)) {
    return { kind: 'feed', feed: topic as LiveFeed, topic };
  }
  const at = topic.indexOf(':');
  if (at <= 0) {
    return null;
  }
  const noun = topic.slice(0, at);
  const rest = topic.slice(at + 1);
  if ((ONE as readonly string[]).includes(noun)) {
    return ID.test(rest) ? { kind: noun as LiveOneNoun, id: Number(rest), topic } : null;
  }
  if (noun === 'list') {
    return SLUG.test(rest) ? { kind: 'list', slug: rest, topic } : null;
  }
  if (noun === 'notification') {
    return USER.test(rest) ? { kind: 'notification', userId: rest, topic } : null;
  }
  return null;
}

/** Builders, so a publisher never spells a topic by hand. */
export const liveTopic = {
  record: (id: number | string) => `record:${id}`,
  list: (typeSlug: string) => `list:${typeSlug}`,
  card: (id: number | string) => `card:${id}`,
  run: (id: number | string) => `run:${id}`,
  mission: (id: number | string) => `mission:${id}`,
  ask: (id: number | string) => `ask:${id}`,
  artifact: (id: number | string) => `artifact:${id}`,
  /**
   * The topic a person's notifications arrive on (backlog 048).
   * @param userId - The person, as their session names them.
   */
  notification: (userId: string) => `notification:${userId}`,
  feed: (feed: LiveFeed) => feed,
};

/**
 * The topics that carry changes to a thing the app points at (a `RecordRef`
 * or a turn's follow-up ref): a record by either of its spellings, its
 * version history, an artifact, a run, an agent run, an ask. Refs the stream
 * does not publish (a CRM deal, a document) follow nothing.
 * @param ref - The ref.
 * @param ref.type - Its type.
 * @param ref.id - Its id.
 */
export function topicsForRef(ref: { type: string; id: string | number }): string[] {
  const id = String(ref.id);
  const own = (noun: string, value: string) => (ID.test(value) ? [`${noun}:${value}`] : []);
  switch (ref.type) {
    case 'object':
    case 'request':
      return own('record', id);
    case 'record_history':
      return own('record', id.split('@')[0] ?? '');
    case 'artifact':
      return own('artifact', id);
    case 'worker_run':
      return own('run', id);
    case 'mission_run':
      return own('mission', id);
    case 'ask':
      return own('ask', id);
    default:
      return [];
  }
}

/**
 * Whether a notice concerns any of these topics.
 * @param notice - The notice.
 * @param notice.topics - Its topics.
 * @param topics - What a follower follows.
 */
export function noticeMatches(notice: Pick<LiveNotice, 'topics'>, topics: ReadonlySet<string>): boolean {
  return notice.topics.some(t => topics.has(t));
}
