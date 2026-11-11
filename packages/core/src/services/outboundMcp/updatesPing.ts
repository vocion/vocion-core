/**
 * "CHECK NOW" FROM A CONNECTED SYSTEM.
 *
 * A source that reports updates (`updatesTool`) is not read on a timer. The
 * workspace gives the provider one address (`updatesHookUrl`), through the
 * provider's own registration tool (`updatesWatchTool`), and the provider
 * POSTs to it the moment it has something to say. The ping carries nothing we
 * act on: receiving it only makes the workspace read the source's updates
 * now, with its own credential (`services/jobs/mcpUpdates.ts`).
 *
 * Signed without a new secret. Both sides already hold the source's bearer
 * token (the provider usually as its hash), so the key is the hex SHA-256 of
 * that token and the signature is `sha256=` + hex HMAC-SHA256 of
 * `${timestamp}.${body}`. A ping older than five minutes is refused.
 */
import { Buffer } from 'node:buffer';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appBaseUrl } from '@/libs/links';

const WINDOW_MS = 5 * 60 * 1000;

/**
 * The address a provider pings for one source of one workspace; null when the app has no public address.
 * @param orgId - The workspace.
 * @param sourceSlug - The source.
 */
export function updatesHookUrl(orgId: string, sourceSlug: string): string | null {
  const base = appBaseUrl();
  return base.startsWith('https://') ? `${base}/api/webhooks/mcp/${encodeURIComponent(orgId)}/${encodeURIComponent(sourceSlug)}` : null;
}

/**
 * Whether a ping was signed by whoever holds this source's token, recently.
 * @param ping - What arrived.
 * @param ping.token - The source's bearer token, from the vault.
 * @param ping.timestamp - The `x-updates-timestamp` header (ms).
 * @param ping.signature - The `x-updates-signature` header.
 * @param ping.body - The raw body.
 * @param ping.now - The clock, for tests.
 */
export function verifyUpdatesPing(ping: { token: string; timestamp: string | null; signature: string | null; body: string; now?: number }): { ok: true } | { ok: false; reason: 'unsigned' | 'stale' | 'bad_signature' } {
  if (!ping.timestamp || !ping.signature) {
    return { ok: false, reason: 'unsigned' };
  }
  const at = Number(ping.timestamp);
  if (!Number.isFinite(at) || Math.abs((ping.now ?? Date.now()) - at) > WINDOW_MS) {
    return { ok: false, reason: 'stale' };
  }
  const key = createHash('sha256').update(ping.token).digest('hex');
  const expected = Buffer.from(`sha256=${createHmac('sha256', key).update(`${ping.timestamp}.${ping.body}`).digest('hex')}`);
  const given = Buffer.from(ping.signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/** One read per source at a time; a ping that arrives during it asks for one more when it ends. */
const running = new Map<string, { again: boolean }>();

/**
 * Read a source's updates now, without two reads of one source overlapping.
 * @param orgId - The workspace.
 * @param sourceSlug - The source that pinged.
 * @param run - The read.
 */
export async function readUpdatesNow(orgId: string, sourceSlug: string, run: () => Promise<unknown>): Promise<'started' | 'queued'> {
  const key = `${orgId}:${sourceSlug}`;
  const current = running.get(key);
  if (current) {
    current.again = true;
    return 'queued';
  }
  const state = { again: false };
  running.set(key, state);
  void (async () => {
    try {
      do {
        state.again = false;
        await run().catch(() => undefined);
      } while (state.again);
    } finally {
      running.delete(key);
    }
  })();
  return 'started';
}
