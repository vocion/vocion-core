import { NextResponse } from 'next/server';
import { vapidConfig } from '@/libs/notifications/webPush';
import { serverChannels } from '@/services/notifications/notify';
import { authApi, isErrorResponse } from '../../_shared';

/**
 * GET /api/v1/push/config
 *
 * What a device needs to subscribe: the VAPID public key a browser's Push API
 * subscription is made with (`webPushPublicKey`, null when this server has
 * no Chrome notifications), and whether iPhone push is configured.
 * Auth: dashboard session or tenant token.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const server = await serverChannels();
  return NextResponse.json({ webPushPublicKey: vapidConfig()?.publicKey ?? null, ios: server.ios, web: server.web }, { headers: { 'Cache-Control': 'private, no-store' } });
}
