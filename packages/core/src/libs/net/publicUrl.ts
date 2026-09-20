/**
 * "Is this URL safe for the server to fetch?" — the guard every tool that
 * dereferences a URL a model produced needs.
 *
 * A model can be talked into a URL, and the server fetching it sits inside
 * the network the client cannot reach: the cloud metadata service, an
 * internal admin page, a database on a private address, a `file://` path on
 * the box. So a tool that fetches bytes checks the scheme, the host, and —
 * because a public hostname can resolve to 127.0.0.1 — every address the
 * host resolves to, on every redirect hop.
 *
 * Split so the decision is testable without a network: `urlShape` and
 * `isPrivateAddress` are pure, `resolvesPublicly` adds DNS.
 */

import { lookup } from 'node:dns/promises';

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/** Literal hostnames that never leave the box, whatever DNS says. */
const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/**
 * True for an address a public client could not reach: loopback, link-local
 * (including the cloud metadata address 169.254.169.254), private and
 * carrier-grade ranges, multicast, reserved, and the IPv6 equivalents.
 * @param ip - A numeric address, v4 or v6.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  // An IPv4-mapped IPv6 address is an IPv4 address wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) {
    return isPrivateAddress(mapped[1]!);
  }
  if (addr.includes(':')) {
    if (addr === '::' || addr === '::1') {
      return true;
    }
    const head = Number.parseInt(addr.split(':')[0] || '0', 16);
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    return (head & 0xFE00) === 0xFC00 || (head & 0xFFC0) === 0xFE80 || (head & 0xFF00) === 0xFF00;
  }
  const parts = addr.split('.');
  if (parts.length !== 4) {
    // Not an address we can reason about — refuse rather than guess.
    return true;
  }
  const [a, b] = parts.map(p => Number(p)) as [number, number, number, number];
  if (parts.some(p => !/^\d{1,3}$/.test(p)) || [a, b].some(n => !Number.isInteger(n) || n > 255)) {
    return true;
  }
  return a === 0 // "this network"
    || a === 10
    || a === 127 // loopback
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, incl. cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0) // IETF protocol assignments
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || a >= 224; // multicast and reserved
}

/**
 * The checks that need no network: the scheme is http(s), there is a host,
 * and the host is not a local name or a private address literal.
 * @param raw - The URL as given.
 */
export function urlShape(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `"${raw.slice(0, 80)}" is not a URL.` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `${url.protocol}// is not fetched — only http and https. A file on the box is not something this can read.` };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { ok: false, reason: 'that URL has no host.' };
  }
  if (LOCAL_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: `${url.hostname} is on this machine or this network, not the public internet.` };
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddress(host)) {
      return { ok: false, reason: `${url.hostname} is a private or loopback address, not the public internet.` };
    }
  }
  return { ok: true, url };
}

/**
 * The shape checks plus DNS: every address the host resolves to has to be
 * public, because a public name may point at a private address deliberately.
 * @param raw - The URL as given.
 */
export async function resolvesPublicly(raw: string): Promise<UrlVerdict> {
  const shape = urlShape(raw);
  if (!shape.ok) {
    return shape;
  }
  const host = shape.url.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return shape;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: `${host} does not resolve.` };
  }
  const bad = addresses.find(a => isPrivateAddress(a.address));
  if (bad) {
    return { ok: false, reason: `${host} resolves to ${bad.address}, a private address.` };
  }
  return shape;
}
