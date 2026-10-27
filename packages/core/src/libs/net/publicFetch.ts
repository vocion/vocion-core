/**
 * Fetch a URL a model produced, safely: the address is public on every
 * redirect hop (`./publicUrl.ts`), and the body is capped while it is read.
 *
 * Shared by every tool that dereferences a model's URL and needs the bytes
 * rather than a provider's extraction of them: the image fetcher
 * (`libs/tools/image/remote.ts`) and the page reader that SERP research uses
 * (`libs/tools/browse/builtin.ts` → `fetchHtml`). One guard, so a fix to it
 * covers both.
 */

import { Buffer } from 'node:buffer';
import { resolvesPublicly } from './publicUrl';

/**
 * Why a fetch was refused: `blocked` (not a public address) and `too_large`
 * will refuse the same way next time; `http` and `network` might not.
 */
export type PublicFetchErrorCode = 'blocked' | 'too_large' | 'http' | 'network';

export class PublicFetchError extends Error {
  constructor(message: string, public readonly code: PublicFetchErrorCode = 'http', public readonly status: number | null = null) {
    super(message);
    this.name = 'PublicFetchError';
  }
}

export type PublicFetchOptions = {
  /** Request headers (a User-Agent, an Accept). */
  headers?: Record<string, string>;
  /** Per-hop timeout. Default 15s. */
  timeoutMs?: number;
  /** Redirects to follow, each one checked. Default 4. */
  hops?: number;
};

/**
 * Follow up to `hops` redirects by hand, checking each destination is still
 * a public address. `redirect: 'follow'` would do the hops inside fetch,
 * where the guard cannot see them.
 * @param raw - The URL to fetch.
 * @param opts - Headers, timeout and hop count.
 * @returns The final, successful response. Its `url` may be empty under a
 * stubbed fetch, so callers that need the final address read `finalUrl`.
 */
export async function fetchPublic(raw: string, opts: PublicFetchOptions = {}): Promise<{ res: Response; finalUrl: string }> {
  const hops = opts.hops ?? 4;
  let target = raw;
  for (let i = 0; i <= hops; i++) {
    const verdict = await resolvesPublicly(target);
    if (!verdict.ok) {
      throw new PublicFetchError(verdict.reason, 'blocked');
    }
    let res: Response;
    try {
      res = await fetch(verdict.url, {
        redirect: 'manual',
        headers: opts.headers ?? {},
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new PublicFetchError(`${verdict.url.host} did not answer (${(err as Error).message || 'network error'}).`, 'network');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) {
        throw new PublicFetchError(`the server redirected (HTTP ${res.status}) with no destination.`);
      }
      await res.body?.cancel().catch(() => {});
      target = new URL(next, verdict.url).toString();
      continue;
    }
    if (!res.ok) {
      throw new PublicFetchError(`HTTP ${res.status} from ${verdict.url.host}.`, 'http', res.status);
    }
    return { res, finalUrl: verdict.url.toString() };
  }
  throw new PublicFetchError('too many redirects.');
}

/**
 * Read a capped body. The cap is enforced chunk by chunk so an enormous
 * response is abandoned rather than buffered.
 * @param res - The response.
 * @param maxBytes - The cap.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PublicFetchError(`it is ${Math.round(declared / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB cap.`, 'too_large');
  }
  const body = res.body;
  if (!body) {
    throw new PublicFetchError('the response had no body.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PublicFetchError(`it is over the ${Math.round(maxBytes / 1024)} KB cap.`, 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
