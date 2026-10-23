/**
 * Short-lived download links for a checked-out deliverable's files.
 *
 * `deck_checkout` hands an outside assistant the deck's images, and that
 * assistant cannot sign in to Vocion. So each image gets a link that names
 * one stored file in one workspace and expires (an hour by default) — the
 * same signed-and-expiring shape as a brief's listen link
 * (`libs/briefings/listenLink.ts`). Whoever holds it can fetch that one file
 * until it expires, which is what checking the deck out to them granted.
 *
 * Served by `app/api/deck-assets/[token]/route.ts`.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { appBaseUrl } from '@/libs/links';
import { isSafeArtifactFilename } from '@/libs/tools/artifacts/url';

export const DECK_ASSET_ROUTE = '/api/deck-assets';
export const ASSET_LINK_TTL_MS = 60 * 60 * 1000;

export type AssetLinkClaim = { orgId: string; filename: string; exp: number };

function mac(payload: string): string {
  const secret = process.env.VOCION_TOOL_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('asset links need VOCION_TOOL_SIGNING_SECRET or AUTH_SECRET');
  }
  return createHmac('sha256', secret).update(`deck-asset:${payload}`).digest('base64url');
}

/**
 * A signed token for one stored file.
 * @param claim - Which file, in which workspace, until when (epoch ms).
 */
export function assetLinkToken(claim: AssetLinkClaim): string {
  const payload = Buffer.from(JSON.stringify([claim.orgId, claim.filename, claim.exp]), 'utf8').toString('base64url');
  return `${payload}~${mac(payload)}`;
}

/**
 * The link for one stored file, absolute when the app knows its own address.
 * Null when it cannot be signed (no secret) or the URL is not a stored file.
 * @param input - The workspace, the file's served URL, and the clock.
 * @param input.orgId
 * @param input.url - `/api/artifacts/<id>/<filename>`.
 * @param input.now
 * @param input.ttlMs
 */
export function assetDownloadLink(input: { orgId: string; url: string; now?: number; ttlMs?: number }): string | null {
  const filename = storedFilename(input.url);
  if (!filename) {
    return null;
  }
  try {
    const token = assetLinkToken({ orgId: input.orgId, filename, exp: (input.now ?? Date.now()) + (input.ttlMs ?? ASSET_LINK_TTL_MS) });
    return `${appBaseUrl()}${DECK_ASSET_ROUTE}/${token}`;
  } catch {
    return null;
  }
}

/**
 * The claim a token carries, or null when it is not one this server signed or it expired.
 * @param token - From the link.
 * @param now - The clock.
 */
export function readAssetLinkToken(token: string | null | undefined, now: number = Date.now()): AssetLinkClaim | null {
  const t = token ?? '';
  const cut = t.lastIndexOf('~');
  if (cut <= 0 || t.length > 800) {
    return null;
  }
  const payload = t.slice(0, cut);
  const sig = t.slice(cut + 1);
  let wanted: Buffer;
  try {
    wanted = Buffer.from(mac(payload));
  } catch {
    return null;
  }
  const given = Buffer.from(sig);
  if (wanted.length !== given.length || !timingSafeEqual(wanted, given)) {
    return null;
  }
  try {
    const [orgId, filename, exp] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as [unknown, unknown, unknown];
    if (typeof orgId !== 'string' || typeof filename !== 'string' || typeof exp !== 'number' || exp < now || !isSafeArtifactFilename(filename) || !filename.startsWith(`${orgId}-`)) {
      return null;
    }
    return { orgId, filename, exp };
  } catch {
    return null;
  }
}

/**
 * The stored filename behind a served artifact URL (`/api/artifacts/<id>/<file>`
 * or the legacy `/artifacts/<file>`), or null.
 * @param url - A served URL.
 */
export function storedFilename(url: string): string | null {
  const m = /^(?:https?:\/\/[^/]+)?\/(?:api\/)?artifacts\/(?:[\w.-]+\/)?([\w.-]{1,200})$/.exec(url.split('?')[0] ?? '');
  return m && isSafeArtifactFilename(m[1]!) ? m[1]! : null;
}
