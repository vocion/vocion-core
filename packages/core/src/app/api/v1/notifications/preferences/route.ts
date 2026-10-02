import { NextResponse } from 'next/server';
import { parsePreferenceChange, PreferenceError } from '@/libs/notifications/preferences';
import { CHANNEL_DEFAULTS, CHANNEL_LABELS, NOTIFICATION_CHANNELS } from '@/libs/notifications/types';
import { listKinds } from '@/services/notifications/inbox';
import { serverChannels } from '@/services/notifications/notify';
import { NO_PERSON, personOf } from '@/services/notifications/person';
import { getPreferences, setPreferences } from '@/services/notifications/preferences';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../_shared';

async function view(userId: string, orgId: string) {
  const [preferences, kinds, server] = await Promise.all([getPreferences(userId, orgId), listKinds(orgId), serverChannels()]);
  return {
    preferences,
    kinds,
    channels: NOTIFICATION_CHANNELS.map(id => ({ id, label: CHANNEL_LABELS[id], default: CHANNEL_DEFAULTS[id], configured: id === 'in_app' ? true : server[id] })),
  };
}

/**
 * GET /api/v1/notifications/preferences
 *
 * Your notification settings in this workspace: per kind, per channel on/off
 * (a channel a kind does not name takes its default), quiet hours, and where
 * Slack notifications go (`dm` or the workspace's `channel`). With them: the
 * kinds this workspace declares (label, the event, which plugin declared it,
 * when it last fired and whom it reached) and each channel's default and
 * whether this server can send it at all.
 * Auth: dashboard session, or a tenant token (its minter's settings).
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const userId = await personOf(caller);
  if (!userId) {
    return jsonError('FORBIDDEN', NO_PERSON, 403);
  }
  const who = { orgId: caller.orgId, userId };
  return NextResponse.json(await view(who.userId, who.orgId), { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * PUT /api/v1/notifications/preferences  { channels?, quietHours?, slackTarget? }
 *
 * Change your settings; only what you send moves. `channels` is
 * `{ <kind>: { <channel>: true | false } }` over `in_app`, `ios`, `web`,
 * `email`, `slack` (in-app is always on). `quietHours` is
 * `{ start: "22:00", end: "07:00", timeZone: "America/Los_Angeles" }`, or
 * null for none: push, email and Slack inside them wait for the end.
 * `slackTarget` is `dm` or `channel`.
 * Auth: dashboard session, or a tenant token (its minter's settings).
 * @param req - Request.
 */
export async function PUT(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const userId = await personOf(caller);
  if (!userId) {
    return jsonError('FORBIDDEN', NO_PERSON, 403);
  }
  const who = { orgId: caller.orgId, userId };
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  try {
    await setPreferences(who.userId, who.orgId, parsePreferenceChange(body));
  } catch (err) {
    if (err instanceof PreferenceError) {
      return jsonError('VALIDATION_FAILED', err.message, 400);
    }
    throw err;
  }
  return NextResponse.json(await view(who.userId, who.orgId));
}
