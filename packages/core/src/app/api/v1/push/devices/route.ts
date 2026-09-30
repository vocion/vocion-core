import { NextResponse } from 'next/server';
import { DeviceError, listDevices, parseRegistration, registerDevice, removeWebEndpoint } from '@/services/notifications/devices';
import { NO_PERSON, personOf } from '@/services/notifications/person';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../_shared';

/**
 * GET /api/v1/push/devices
 *
 * The devices you asked to be notified on — browsers subscribed from the bell
 * and iPhones whose app registered — newest first, with the last error a
 * device reported.
 * Auth: dashboard session, or a tenant token (its minter's devices).
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
  return NextResponse.json({ devices: await listDevices(who.userId) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * POST /api/v1/push/devices  { platform, token?, bundleId?, environment?, endpoint?, keys?, label? }
 *
 * Register a device for push. The iOS app sends `platform: ios`, the APNs
 * device token as hex, its `bundleId` and `environment` (`production` for
 * TestFlight and the App Store, `sandbox` for a build run from Xcode). A
 * browser sends `platform: web` with its PushSubscription's `endpoint` and
 * `keys` (`p256dh`, `auth`). `label` names the device in settings. The same
 * token again refreshes it (and moves it to you). 201 with the device.
 * Auth: dashboard session (the app signs in with it), or a tenant token.
 * @param req - Request.
 */
export async function POST(req: Request) {
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
    const device = await registerDevice(who.userId, parseRegistration(body));
    return NextResponse.json({ device }, { status: 201 });
  } catch (err) {
    if (err instanceof DeviceError) {
      return jsonError('VALIDATION_FAILED', err.message, 400);
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/push/devices  { endpoint }
 *
 * Stop notifying this browser: removes your web subscription by its
 * endpoint (the browser knows its endpoint, not the row id). A device by id
 * is `DELETE /api/v1/push/devices/:id`.
 * Auth: dashboard session, or a tenant token (its minter's devices).
 * @param req - Request.
 */
export async function DELETE(req: Request) {
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
  if (typeof body.endpoint !== 'string' || !body.endpoint) {
    return jsonError('VALIDATION_FAILED', 'endpoint is required', 400);
  }
  const removed = await removeWebEndpoint(who.userId, body.endpoint);
  return NextResponse.json({ removed });
}
