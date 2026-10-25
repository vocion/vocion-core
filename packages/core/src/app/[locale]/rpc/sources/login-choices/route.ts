/**
 * `/rpc/sources/login-choices?connector=<slug>` — the choices the workspace's
 * stored login for a connector offers its source settings: the ad accounts
 * a LinkedIn or Meta login reaches, by name and id (`libs/connect/loginChoices.ts`).
 * Names and ids only; the token never leaves the server. An empty list when
 * no login is stored, so the form falls back to typed entry.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { loginChoicesFrom } from '@/libs/connect/loginChoices';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { resolvePlatformCredential } from '@/services/ApiTokenService';

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const connector = new URL(request.url).searchParams.get('connector') ?? '';
  const platform = platformForConnectorSlug(connector);
  if (!platform || !platform.howToConnect?.login) {
    return Response.json({ choices: [] });
  }
  try {
    const bag = await resolvePlatformCredential(orgId, platform.id) as Record<string, unknown> | null;
    return Response.json({ choices: loginChoicesFrom(bag) });
  } catch {
    return Response.json({ choices: [] });
  }
}
