/**
 * WHERE A CHANGE CAN BE SEEN LIVE: the product's environment says the host,
 * the request says only the path (2026-09-30: feature #246's "Open feature"
 * went to https://send.com/account, a domain the product does not own; the
 * host had been written by an agent from memory while the product's own
 * environment record said https://app.stampsend.com all along; 58 records
 * carried a guessed host).
 *
 * `resolveLiveUrl` keeps a written URL only when its host is one of the
 * product's environments; otherwise it puts the written path on the
 * product's first environment. With no environment recorded it cannot judge,
 * so the written value stands. Read-time, so existing records heal without
 * an edit.
 */

/**
 * The live URL for a request.
 * @param written - `visuals.surfaceUrl` as stored: a full URL, a path, or null.
 * @param bases - The product's production environment URLs, the one a person uses first.
 */
export function resolveLiveUrl(written: string | null, bases: readonly string[]): string | null {
  const valid = bases.map((b) => {
    try {
      return new URL(b);
    } catch {
      return null;
    }
  }).filter((u): u is URL => u !== null);
  if (!written) {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(written);
  } catch {
    parsed = null;
  }
  if (valid.length === 0) {
    return parsed ? parsed.toString() : null;
  }
  if (parsed && valid.some(b => b.host === parsed!.host)) {
    return parsed.toString();
  }
  const path = parsed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : (written.startsWith('/') ? written : `/${written}`);
  return new URL(path, valid[0]!).toString();
}
