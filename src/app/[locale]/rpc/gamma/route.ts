import { auth } from '@clerk/nextjs/server';
import { createGeneration, waitForGeneration } from '@/libs/gamma/client';

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const content = body.content as string;
  const numCards = (body.numCards as number) ?? 14;

  if (!content) {
    return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });
  }

  try {
    const { generationId } = await createGeneration({
      inputText: content,
      textMode: 'condense',
      format: 'presentation',
      numCards,
    });

    // Poll for the real Gamma URL (typically completes in 10-30s)
    const result = await waitForGeneration(generationId);

    if (result.status === 'failed') {
      throw new Error(result.error ?? 'Gamma generation failed');
    }

    return new Response(JSON.stringify({
      generationId,
      url: result.gammaUrl ?? `https://gamma.app/docs/${generationId}`,
      exportUrl: result.exportUrl,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[Gamma RPC]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
