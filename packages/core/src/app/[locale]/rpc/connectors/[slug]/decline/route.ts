/**
 * POST /rpc/connectors/[slug]/decline — somebody read the card and chose to go
 * without.
 *
 * A decline is signal, not a non-event. Offered / granted / declined together
 * answer the only question this feature really has — does putting the
 * connection where the work is get it connected? — and a card nobody ever taps
 * is a card that should not be shown.
 *
 * Nothing is stored beyond the event: the decline is remembered for the
 * conversation in the client, because it is about this thread rather than a
 * standing preference. Somebody who declines Calendar today should still be
 * offered it tomorrow when the work needs it.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { getConnector } from '@/libs/sources/registry';
import { track } from '@/services/adoption/track';

export async function POST(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { slug } = await ctx.params;
  if (!getConnector(slug)) {
    return Response.json({ error: `No connector named ${slug}` }, { status: 404 });
  }
  await track({ orgId, userId }, 'connection.declined', { meta: { connector: slug } });
  return Response.json({ ok: true });
}
