import { auth } from '@clerk/nextjs/server';
import { checkGeneration, createGeneration } from '@/libs/gamma/client';

/**
 * POST: Start a Gamma generation. Returns immediately with generationId.
 */
export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const content = body.content as string;
  const numCards = (body.numCards as number) ?? 14;

  if (!content) {
    return Response.json({ error: 'Content required' }, { status: 400 });
  }

  try {
    const { generationId } = await createGeneration({
      inputText: content,
      textMode: 'condense',
      format: 'presentation',
      numCards,
    });

    return Response.json({ generationId });
  } catch (err: any) {
    console.error('[Gamma RPC] create failed:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET: Check a generation's current status. Returns gammaUrl when completed.
 */
export async function GET(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const generationId = searchParams.get('id');

  if (!generationId) {
    return Response.json({ error: 'id parameter required' }, { status: 400 });
  }

  try {
    const result = await checkGeneration(generationId);

    return Response.json({
      generationId,
      status: result.status,
      url: result.gammaUrl,
      exportUrl: result.exportUrl,
    });
  } catch (err: any) {
    console.error('[Gamma RPC] status check failed:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
