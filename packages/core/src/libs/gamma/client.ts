/**
 * Gamma API client — makes a presentation, document or web page from text (gamma.app).
 * API docs: https://developers.gamma.app/
 *
 * WHICH KEY A CALL SPENDS. The workspace's stored `gamma` key first, the server's
 * `GAMMA_API_KEY` second (`gammaKeyFor`). Every function takes the key it spends, so nothing
 * here holds one between calls. Making a deck spends the account's Gamma credits.
 */

import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const GAMMA_BASE_URL = 'https://public-api.gamma.app';

export type GammaFetch = typeof fetch;

export type GenerationRequest = {
  inputText: string;
  textMode?: 'generate' | 'condense' | 'preserve';
  format?: 'presentation' | 'document' | 'webpage';
  numCards?: number;
  exportAs?: 'pdf' | 'pptx';
  /** A theme id from `listThemes`. */
  themeId?: string;
  /** Extra instructions: tone, audience, what to emphasise. */
  additionalInstructions?: string;
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
 * The key a workspace's Gamma calls spend: its own, else the server's, else null.
 * @param orgId - The workspace, or null on a path with no org.
 */
export async function gammaKeyFor(orgId: string | null): Promise<string | null> {
  if (orgId) {
    const { resolvePlatformKey } = await import('@/services/ApiTokenService');
    const stored = await resolvePlatformKey(orgId, 'gamma').catch(() => null);
    if (stored) {
      return stored;
    }
  }
  return process.env.GAMMA_API_KEY?.trim() || null;
}

/**
 * The key out of a vaulted credential.
 * @param values - The `gamma` credential's fields.
 */
export function gammaKeyFrom(values: Record<string, unknown> | null | undefined): string | null {
  const key = typeof values?.apiKey === 'string' ? values.apiKey.trim() : '';
  return key || null;
}

/**
 * One call to Gamma, its refusal as a sentence that names no key.
 * @param apiKey - The key.
 * @param path - Under the API base.
 * @param init - Method and JSON body.
 * @param init.method - Default GET.
 * @param init.json - A JSON body.
 * @param fetchImpl - Injectable for tests.
 */
async function gammaApi<T>(apiKey: string, path: string, init: { method?: 'GET' | 'POST'; json?: unknown } = {}, fetchImpl: GammaFetch = fetch): Promise<T> {
  const res = await fetchImpl(`${GAMMA_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
    if (res.status === 401 || res.status === 403) {
      throw new Error('Gamma refused the API key. Make a new one in Gamma\'s settings → API key and paste it again.');
    }
    if (res.status === 429) {
      throw new Error('Gamma is rate limiting this key; try again in a minute.');
    }
    throw new Error(`Gamma answered ${res.status}${body.message || body.error ? `: ${body.message ?? body.error}` : ''}.`);
  }
  return res.json() as Promise<T>;
}

/**
 * The account's themes — the cheap read Test connection makes; it spends no credits.
 * @param apiKey - The key.
 * @param fetchImpl - Injectable for tests.
 */
export async function listThemes(apiKey: string, fetchImpl: GammaFetch = fetch): Promise<{ id: string; name: string }[]> {
  const body = await gammaApi<{ data?: { id?: string; name?: string }[] } | { id?: string; name?: string }[]>(apiKey, '/v1.0/themes?limit=50', {}, fetchImpl);
  const rows = Array.isArray(body) ? body : body.data ?? [];
  return rows.filter(t => t.id).map(t => ({ id: t.id!, name: t.name ?? t.id! }));
}

/**
 * Start a new Gamma generation from text content.
 * @param apiKey - The key it spends.
 * @param request - What to make.
 * @param fetchImpl - Injectable for tests.
 */
export async function createGeneration(apiKey: string, request: GenerationRequest, fetchImpl: GammaFetch = fetch): Promise<{ generationId: string }> {
  return gammaApi<{ generationId: string }>(apiKey, '/v1.0/generations', {
    method: 'POST',
    json: {
      inputText: request.inputText,
      textMode: request.textMode ?? 'condense',
      format: request.format ?? 'presentation',
      numCards: request.numCards ?? 12,
      ...(request.exportAs ? { exportAs: request.exportAs } : {}),
      ...(request.themeId ? { themeId: request.themeId } : {}),
      ...(request.additionalInstructions ? { additionalInstructions: request.additionalInstructions } : {}),
    },
  }, fetchImpl);
}

/**
 * Check the current status of a generation (single request, no polling).
 * @param apiKey - The key.
 * @param generationId - The generation.
 * @param fetchImpl - Injectable for tests.
 */
export async function checkGeneration(apiKey: string, generationId: string, fetchImpl: GammaFetch = fetch): Promise<GenerationStatus> {
  if (!/^[\w-]+$/.test(generationId)) {
    throw new Error(`${generationId} is not a Gamma generation id.`);
  }
  return gammaApi<GenerationStatus>(apiKey, `/v1.0/generations/${generationId}`, {}, fetchImpl);
}

/**
 * Poll a generation until it completes or fails.
 * @param apiKey - The key.
 * @param generationId - The generation.
 * @param opts - Timing.
 * @param opts.maxWaitMs - Give up after this long (default 2 minutes).
 * @param opts.pollIntervalMs - Between polls (default 5 seconds).
 * @param opts.onProgress - Each status as it is read.
 * @param fetchImpl - Injectable for tests.
 */
export async function waitForGeneration(
  apiKey: string,
  generationId: string,
  opts?: { maxWaitMs?: number; pollIntervalMs?: number; onProgress?: (status: GenerationStatus) => void },
  fetchImpl: GammaFetch = fetch,
): Promise<GenerationStatus> {
  const maxWait = opts?.maxWaitMs ?? 120_000;
  const pollInterval = opts?.pollIntervalMs ?? 5_000;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const status = await checkGeneration(apiKey, generationId, fetchImpl);
    opts?.onProgress?.(status);
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    await sleep(pollInterval);
  }
  return { generationId, status: 'failed', error: 'Timed out waiting for generation' };
}
