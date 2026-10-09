/**
 * A person's OWN connections — the one list (docs/guides/personal-connections.md).
 *
 * A shared workspace connects a system for everyone in it: an admin logs in,
 * the grant is the workspace's, and its agents read it through sources. A
 * personal connection is the other kind. Any member connects their own mail,
 * calendar, files, Slack DMs and GitHub from Personal connectors, the grant
 * is stored in their personal workspace (one per person per Org, which only
 * they can open, admins included), and only their own assistant reads it,
 * live, through the tools each entry names. It never becomes a source, so
 * nothing from it is synced, embedded or shown to anyone else.
 *
 * This file is the only place a personal connection is named. The connect
 * routes, the gate, the assistant's tools and the Connectors panel all read
 * this list; adding a connection is a descriptor here plus its tools.
 *
 * ## Scopes, and how Google classifies them
 *
 * Every scope a personal login asks for is below and nowhere else. Google
 * sorts OAuth scopes into three tiers, and the tier decides what an app must
 * pass before people outside its own Google Workspace may grant it
 * (docs/security/google-api-data-handling.md):
 *
 * | Scope | Google tier | Why |
 * |---|---|---|
 * | `openid`, `email` | non-sensitive | Which Google account was connected, shown on the row. |
 * | `gmail.readonly` | **restricted** | `mail_search`, `mail_read`: find and read the person's mail. |
 * | `gmail.compose` | **restricted** | `mail_draft_reply`: create drafts. Google has no drafts-only scope; this one also permits sending, so "never sends" is enforced in code: no path here calls `messages.send` or `drafts.send` (`libs/personal/google.ts`, pinned by its test). |
 * | `calendar.readonly` | sensitive | `calendar_today`, `calendar_range`. |
 * | `drive.readonly` | **restricted** | `drive_search`, `drive_read`. |
 *
 * Restricted scopes need Google's verification plus an annual CASA security
 * assessment before an External app may serve them to the public. An
 * Internal-type app (people inside the app owner's Google Workspace only)
 * needs neither, which is why the personal Google app is configured apart
 * from the sign-in one (`GOOGLE_PERSONAL_CLIENT_ID`, `serverClients.ts`).
 *
 * Slack and GitHub have no tiers. Slack's are USER scopes (the person's own
 * token, not the workspace bot's), the narrowest that let a person search and
 * read their direct messages. GitHub has no read-only scope for private
 * repositories on an OAuth app: `repo` is the only one that reads them, and
 * it also writes. The tools only ever GET. A GitHub App's client
 * (`GITHUB_APP_CLIENT_ID`, the fallback) ignores scopes and is bounded by the
 * app's own read-only permissions instead, which is the setup to prefer.
 */

import type { ConnectProviderId } from '@/libs/connect/provider';

/**
 * Google scopes per personal connection. The login adds the non-sensitive
 * identity scopes `openid` and `email` (`providers/google.ts`). Tiers are in
 * the file's comment.
 */
export const PERSONAL_GOOGLE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'gmail': [
    'https://www.googleapis.com/auth/gmail.readonly', // restricted
    'https://www.googleapis.com/auth/gmail.compose', // restricted — drafts only, enforced in code
  ],
  'google-calendar': ['https://www.googleapis.com/auth/calendar.readonly'], // sensitive
  'drive': ['https://www.googleapis.com/auth/drive.readonly'], // restricted
};

/** Slack USER scopes for a person's own DMs: list and read them, and search across them. */
export const PERSONAL_SLACK_USER_SCOPES = ['im:read', 'im:history', 'mpim:read', 'mpim:history', 'search:read', 'users:read'] as const;

/** GitHub OAuth scopes for a person's own GitHub. Ignored by a GitHub App's client, which its permissions bound instead. */
export const PERSONAL_GITHUB_SCOPES = ['read:user', 'repo'] as const;

/** One kind of thing a person can connect for their own assistant. */
export type PersonalConnection = {
  /** The connector slug the login is made for: the platform it is stored under and the brand it is drawn with come from it. */
  connector: string;
  /** The vendor login it runs on. */
  provider: ConnectProviderId;
  /** What a person reads on the row. */
  label: string;
  /** What connecting it lets the assistant do, in one line. */
  unlocks: string;
  /** The assistant's tools that read it. */
  tools: readonly string[];
};

export const PERSONAL_CONNECTIONS: readonly PersonalConnection[] = [
  { connector: 'gmail', provider: 'google', label: 'Gmail', unlocks: 'Searches and reads your mail, and writes replies into your Drafts. It never sends.', tools: ['mail_search', 'mail_read', 'mail_draft_reply'] },
  { connector: 'google-calendar', provider: 'google', label: 'Google Calendar', unlocks: 'Reads your day and the days ahead.', tools: ['calendar_today', 'calendar_range'] },
  { connector: 'drive', provider: 'google', label: 'Google Drive', unlocks: 'Finds and reads your files.', tools: ['drive_search', 'drive_read'] },
  { connector: 'slack', provider: 'slack', label: 'Slack DMs', unlocks: 'Searches your direct messages, as you.', tools: ['slack_dm_search'] },
  { connector: 'github', provider: 'github', label: 'GitHub', unlocks: 'Reads what is on you: reviews asked of you, your pull requests, your issues.', tools: ['github_my_work', 'github_read'] },
];

/**
 * The personal connection for a connector slug, or null when there is none.
 * @param connector - A connector slug, e.g. `gmail`.
 */
export function personalConnectionFor(connector: string): PersonalConnection | null {
  return PERSONAL_CONNECTIONS.find(c => c.connector === connector) ?? null;
}
