import type { KindChannelSettings, NotificationChannel, NotificationPreferences, QuietHours, SlackTarget } from './types';
import { validQuietHours } from './quietHours';
import { CHANNEL_DEFAULTS, DEFAULT_PREFERENCES, isNotificationChannel, NOTIFICATION_CHANNELS } from './types';

/**
 * Whether a channel is on for a kind: the person's word, else the channel's
 * default. In-app is on whatever is stored.
 * @param prefs - The person's settings.
 * @param kind - The notification kind.
 * @param channel - The channel.
 */
export function channelOn(prefs: Pick<NotificationPreferences, 'channels'>, kind: string, channel: NotificationChannel): boolean {
  if (channel === 'in_app') {
    return true;
  }
  const set = prefs.channels[kind]?.[channel];
  return typeof set === 'boolean' ? set : CHANNEL_DEFAULTS[channel];
}

/**
 * Every channel on for a kind, in the one order channels are listed.
 * @param prefs
 * @param kind
 */
export function channelsFor(prefs: Pick<NotificationPreferences, 'channels'>, kind: string): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter(c => channelOn(prefs, kind, c));
}

/**
 * A preference change, validated. Throws a person-readable error on a bad
 * field; absent fields are left as they are.
 */
export type PreferenceChange = {
  channels?: KindChannelSettings;
  quietHours?: QuietHours | null;
  slackTarget?: SlackTarget;
};

export class PreferenceError extends Error {}

/**
 * Read an untrusted change (API body, MCP input, settings page) into a
 * {@link PreferenceChange}.
 * @param raw - The body.
 */
export function parsePreferenceChange(raw: unknown): PreferenceChange {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PreferenceError('body must be an object with channels, quietHours or slackTarget');
  }
  const body = raw as Record<string, unknown>;
  const out: PreferenceChange = {};
  if ('channels' in body) {
    const channels = body.channels;
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
      throw new PreferenceError('channels must be an object: { <kind>: { <channel>: true | false } }');
    }
    const parsed: KindChannelSettings = {};
    for (const [kind, set] of Object.entries(channels as Record<string, unknown>)) {
      if (!set || typeof set !== 'object' || Array.isArray(set)) {
        throw new PreferenceError(`channels.${kind} must be an object of channel → true | false`);
      }
      parsed[kind] = {};
      for (const [channel, on] of Object.entries(set as Record<string, unknown>)) {
        if (!isNotificationChannel(channel)) {
          throw new PreferenceError(`unknown channel "${channel}" — one of ${NOTIFICATION_CHANNELS.join(', ')}`);
        }
        if (typeof on !== 'boolean') {
          throw new PreferenceError(`channels.${kind}.${channel} must be true or false`);
        }
        if (channel !== 'in_app') {
          parsed[kind]![channel] = on;
        }
      }
    }
    out.channels = parsed;
  }
  if ('quietHours' in body) {
    const q = body.quietHours;
    if (q === null) {
      out.quietHours = null;
    } else if (validQuietHours(q as QuietHours)) {
      const { start, end, timeZone } = q as QuietHours;
      out.quietHours = { start, end, timeZone };
    } else {
      throw new PreferenceError('quietHours must be null or { start: "HH:MM", end: "HH:MM", timeZone: "<IANA zone>" } with start ≠ end');
    }
  }
  if ('slackTarget' in body) {
    if (body.slackTarget !== 'dm' && body.slackTarget !== 'channel') {
      throw new PreferenceError('slackTarget must be "dm" or "channel"');
    }
    out.slackTarget = body.slackTarget;
  }
  return out;
}

/**
 * Apply a change over stored settings. Kinds merge channel by channel, so a
 * page that sends one toggle never clears the others.
 * @param current - What is stored.
 * @param change - What changes.
 */
export function mergePreferences(current: NotificationPreferences, change: PreferenceChange): NotificationPreferences {
  const channels: KindChannelSettings = { ...current.channels };
  for (const [kind, set] of Object.entries(change.channels ?? {})) {
    channels[kind] = { ...channels[kind], ...set };
  }
  return {
    channels,
    quietHours: change.quietHours === undefined ? current.quietHours : change.quietHours,
    slackTarget: change.slackTarget ?? current.slackTarget,
  };
}

export { DEFAULT_PREFERENCES };
