import { describe, expect, it } from 'vitest';
import { channelOn, channelsFor, mergePreferences, parsePreferenceChange, PreferenceError } from './preferences';
import { DEFAULT_PREFERENCES } from './types';

describe('channel defaults', () => {
  it('in-app, iPhone and Chrome on; email and Slack off until turned on', () => {
    expect(channelsFor(DEFAULT_PREFERENCES, 'released')).toEqual(['in_app', 'ios', 'web']);
  });

  it('a person\'s word wins per kind, and in-app cannot be turned off', () => {
    const prefs = { channels: { released: { email: true, ios: false, in_app: false } } };

    expect(channelsFor(prefs, 'released')).toEqual(['in_app', 'web', 'email']);
    expect(channelOn(prefs, 'needs-person', 'email')).toBe(false);
  });
});

describe('parsePreferenceChange', () => {
  it('reads channels, quiet hours and the Slack target', () => {
    expect(parsePreferenceChange({
      channels: { 'needs-person': { slack: true, in_app: false } },
      quietHours: { start: '22:00', end: '07:00', timeZone: 'Europe/London' },
      slackTarget: 'channel',
    })).toEqual({
      channels: { 'needs-person': { slack: true } },
      quietHours: { start: '22:00', end: '07:00', timeZone: 'Europe/London' },
      slackTarget: 'channel',
    });
    expect(parsePreferenceChange({ quietHours: null })).toEqual({ quietHours: null });
  });

  it('refuses what it cannot read, saying what it wanted', () => {
    expect(() => parsePreferenceChange({ channels: { released: { fax: true } } })).toThrow(PreferenceError);
    expect(() => parsePreferenceChange({ channels: { released: { email: 'yes' } } })).toThrow(/true or false/);
    expect(() => parsePreferenceChange({ quietHours: { start: '9pm', end: '7am', timeZone: 'UTC' } })).toThrow(/HH:MM/);
    expect(() => parsePreferenceChange({ slackTarget: 'everyone' })).toThrow(/dm/);
    expect(() => parsePreferenceChange([])).toThrow(PreferenceError);
  });
});

describe('mergePreferences', () => {
  it('moves only what the change names, channel by channel', () => {
    const current = { channels: { released: { email: true, slack: true } }, quietHours: { start: '22:00', end: '07:00', timeZone: 'UTC' }, slackTarget: 'dm' as const };

    expect(mergePreferences(current, { channels: { released: { slack: false } } })).toEqual({
      channels: { released: { email: true, slack: false } },
      quietHours: current.quietHours,
      slackTarget: 'dm',
    });
    expect(mergePreferences(current, { quietHours: null }).quietHours).toBeNull();
  });
});
