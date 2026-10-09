import { clerkAuth as auth } from '@/libs/Auth';
import { checkGeneration, createGeneration, gammaKeyFor } from '@/libs/gamma/client';
import { logger } from '@/libs/Logger';

/**
 * The proposal card's "Send to Gamma" (`features/dashboard/ProposalCard.tsx`), on the
 * workspace's own Gamma key when it stored one and the server's `GAMMA_API_KEY` otherwise.
 */

const NO_KEY = 'Gamma is not connected: add a Gamma API key on Connectors.';

/**
 * POST: Start a Gamma generation. Returns immediately with generationId.
 * @param request - `{ content, numCards? }`.
 */
export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { content?: unknown; numCards?: unknown };
  const content = typeof body.content === 'string' ? body.content : '';
  const numCards = typeof body.numCards === 'number' ? body.numCards : 14;
  if (!content) {
    return Response.json({ error: 'Content required' }, { status: 400 });
  }
  const apiKey = await gammaKeyFor(orgId);
  if (!apiKey) {
    return Response.json({ error: NO_KEY }, { status: 501 });
  }
  try {
    const { generationId } = await createGeneration(apiKey, { inputText: content, textMode: 'condense', format: 'presentation', numCards });
    return Response.json({ generationId });
  } catch (err) {
    logger.error('gamma create failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: err instanceof Error ? err.message : 'Gamma did not start the deck.' }, { status: 502 });
  }
}

/**
 * GET: Check a generation's current status. Returns the Gamma URL when completed.
 * @param request - `?id=<generationId>`.
 */
export async function GET(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const generationId = new URL(request.url).searchParams.get('id');
  if (!generationId) {
    return Response.json({ error: 'id parameter required' }, { status: 400 });
  }
  const apiKey = await gammaKeyFor(orgId);
  if (!apiKey) {
    return Response.json({ error: NO_KEY }, { status: 501 });
  }
  try {
    const result = await checkGeneration(apiKey, generationId);
    return Response.json({ generationId, status: result.status, url: result.gammaUrl, exportUrl: result.exportUrl });
  } catch (err) {
    logger.error('gamma status failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: err instanceof Error ? err.message : 'Gamma did not answer.' }, { status: 502 });
  }
}
