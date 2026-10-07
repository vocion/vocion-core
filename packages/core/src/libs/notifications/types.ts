/**
 * The notification noun's shared shapes (backlog 048) — pure, safe on the
 * client. The schema (`models/Schema.ts`), the services, the API and the
 * settings page all read these, so a channel or a preference field is
 * defined once.
 */

/** Where a notification can be delivered. `in_app` is the notification row itself. */
export const NOTIFICATION_CHANNELS = ['in_app', 'ios', 'web', 'email', 'slack', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** What a person reads for each channel, in settings and on a delivery line. */
export const CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  in_app: 'In-app',
  ios: 'iPhone',
  web: 'Chrome',
  email: 'Email',
  slack: 'Slack',
  sms: 'Text message',
};

/**
 * The default for a channel a person has not set. In-app is always on — the
 * bell is where every notification is kept. Push to iPhone and Chrome is on,
 * and reaches a device only once that device registered, so the default is
 * "on for the devices you asked for". Email and Slack are off until a person
 * turns them on (Chris, 2026-09-30). So is a text message: it goes to the
 * mobile number on the person's profile, and a phone that buzzes for every
 * kind is a phone that gets muted.
 */
export const CHANNEL_DEFAULTS: Readonly<Record<NotificationChannel, boolean>> = {
  in_app: true,
  ios: true,
  web: true,
  email: false,
  slack: false,
  sms: false,
};

/** Channels a person may switch. In-app is the record and cannot be turned off. */
export const SWITCHABLE_CHANNELS: readonly NotificationChannel[] = NOTIFICATION_CHANNELS.filter(c => c !== 'in_app');

export function isNotificationChannel(v: unknown): v is NotificationChannel {
  return typeof v === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(v);
}

/** Per kind, per channel on/off. A channel absent from a kind takes its default. */
export type KindChannelSettings = Record<string, Partial<Record<NotificationChannel, boolean>>>;

/**
 * Quiet hours on the person's own clock: `start` and `end` as `HH:MM`, in
 * `timeZone`. Across midnight when `start` > `end` (22:00 → 07:00). Push,
 * email and Slack that land inside them wait for the end; in-app never waits.
 */
export type QuietHours = { start: string; end: string; timeZone: string };

export type SlackTarget = 'dm' | 'channel';

export type NotificationPreferences = {
  channels: KindChannelSettings;
  quietHours: QuietHours | null;
  slackTarget: SlackTarget;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = { channels: {}, quietHours: null, slackTarget: 'dm' };

/** Who a declared notification goes to. */
export type NotificationWho
  = | 'accountable'
    | 'admins'
    | 'members'
    | { user: string }
    | { field: string };

/**
 * One `notifications:` entry as the applier stores it. Templates carry
 * `{field}` placeholders filled from the event's payload
 * (`libs/rest/template.ts` rules): a placeholder whose field is absent
 * renders empty, and a string whose every placeholder is absent is dropped.
 */
export type NotificationRuleConfig = {
  kind: string;
  label: string;
  description?: string;
  event: string;
  filter?: Record<string, unknown>;
  who: NotificationWho | NotificationWho[];
  title: string;
  body?: string;
  /** An app path (`/dashboard/…`). Omit to open the record's own page. */
  link?: string;
  /** The record the notification is about: its object type and id. */
  record?: { type: string; id: string };
  /** What makes two events the same notification. Default: the record. */
  dedupe?: string;
};

/** A delivery's state, as the list and the API show it. */
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';
