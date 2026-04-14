/**
 * Gamma API Client
 *
 * Generates presentations from text content using Gamma.app API.
 * API docs: https://developers.gamma.app/
 */

const GAMMA_API_KEY = process.env.GAMMA_API_KEY || '';
const GAMMA_BASE_URL = 'https://public-api.gamma.app';

const headers = () => ({
  'X-API-KEY': GAMMA_API_KEY,
  'Content-Type': 'application/json',
});

export type GenerationRequest = {
  inputText: string;
  textMode?: 'generate' | 'condense' | 'preserve';
  format?: 'presentation' | 'document' | 'webpage';
  numCards?: number;
  exportAs?: 'pdf' | 'pptx';
};

export type GenerationStatus = {
  generationId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  gammaUrl?: string;
  exportUrl?: string;
  credits?: { deducted: number; remaining: number };
  error?: string;
};

/**
 * Start a new Gamma generation from text content.
 * @param request
 */
export async function createGeneration(request: GenerationRequest): Promise<{ generationId: string }> {
  if (!GAMMA_API_KEY) {
    throw new Error('GAMMA_API_KEY is not configured');
  }

  const res = await fetch(`${GAMMA_BASE_URL}/v1.0/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      inputText: request.inputText,
      textMode: request.textMode ?? 'condense',
      format: request.format ?? 'presentation',
      numCards: request.numCards ?? 12,
      exportAs: request.exportAs,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gamma API error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Check the current status of a generation (single request, no polling).
 * @param generationId
 */
export async function checkGeneration(generationId: string): Promise<GenerationStatus> {
  const res = await fetch(`${GAMMA_BASE_URL}/v1.0/generations/${generationId}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gamma status error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Poll for generation status until completed or failed.
 * Returns the final status with gammaUrl.
 * @param generationId
 * @param opts
 * @param opts.maxWaitMs
 * @param opts.pollIntervalMs
 * @param opts.onProgress
 */
export async function waitForGeneration(
  generationId: string,
  opts?: { maxWaitMs?: number; pollIntervalMs?: number; onProgress?: (status: GenerationStatus) => void },
): Promise<GenerationStatus> {
  const maxWait = opts?.maxWaitMs ?? 120_000; // 2 min max
  const pollInterval = opts?.pollIntervalMs ?? 5_000; // 5s polls
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const res = await fetch(`${GAMMA_BASE_URL}/v1.0/generations/${generationId}`, {
      headers: headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gamma status error (${res.status}): ${text}`);
    }

    const status: GenerationStatus = await res.json();
    opts?.onProgress?.(status);

    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  return { generationId, status: 'failed', error: 'Timed out waiting for generation' };
}

/**
 * Generate a presentation and wait for the result.
 * Returns the Gamma URL for the completed presentation.
 * @param content
 * @param opts
 * @param opts.numCards
 * @param opts.onProgress
 */
export async function generatePresentation(
  content: string,
  opts?: { numCards?: number; onProgress?: (status: GenerationStatus) => void },
): Promise<{ url: string; exportUrl?: string; generationId: string }> {
  const { generationId } = await createGeneration({
    inputText: content,
    textMode: 'condense',
    format: 'presentation',
    numCards: opts?.numCards ?? 12,
  });

  const result = await waitForGeneration(generationId, {
    onProgress: opts?.onProgress,
  });

  if (result.status === 'failed') {
    throw new Error(result.error ?? 'Gamma generation failed');
  }

  return {
    url: result.gammaUrl ?? `https://gamma.app/docs/${generationId}`,
    exportUrl: result.exportUrl,
    generationId,
  };
}
