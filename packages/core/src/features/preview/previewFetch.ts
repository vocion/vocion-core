/**
 * WHY A PREVIEW DID NOT ARRIVE, AND WHETHER TO ASK AGAIN.
 *
 * During a deploy the server restarts: the request fails at the network, or
 * the proxy answers 502/503 while the new container comes up, or the resolver
 * throws because the database went away underneath it. None of those mean the
 * reference is wrong, and the pane told Chris "Could not load this reference"
 * for exactly that (2026-09-28). So a failure is read as one of:
 *
 *   restarting  a network error, a 5xx, a timeout, anything unrecognised —
 *               retried with backoff, and said as "Vocion is restarting"
 *   missing     the server answered that nothing has this reference (404, 400)
 *   forbidden   the server answered that it is not this person's to read (403)
 *   signed_out  the session ended (401)
 *
 * Only the last three are final, and only they say "Could not load".
 */

export type PreviewFailure = 'restarting' | 'missing' | 'forbidden' | 'signed_out';

/**
 * How long to wait before each retry: 1s, 2s, 4s, then 8s until about half a
 * minute has passed — longer than a deploy's restart, shorter than a person's
 * patience. After the last one the pane keeps saying it is restarting and
 * offers Retry; it never turns into "Could not load".
 */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 8000, 8000];

/**
 * @param error - Whatever `client.preview.get` threw.
 */
export function classifyPreviewError(error: unknown): PreviewFailure {
  const status = typeof (error as { status?: unknown } | null)?.status === 'number' ? (error as { status: number }).status : null;
  if (status === 401) {
    return 'signed_out';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404 || status === 400) {
    return 'missing';
  }
  return 'restarting';
}

/** What a final failure says, after "Could not load <what it is>". */
export const FAILURE_REASON: Record<Exclude<PreviewFailure, 'restarting'>, string> = {
  missing: 'Nothing in this workspace has this reference.',
  forbidden: 'It is not shared with you.',
  signed_out: 'Your session ended. Sign in again to read it.',
};
