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
 * Parse an IPv6 literal into its eight 16-bit words: expands `::` and accepts
 * a trailing dotted IPv4 (`::ffff:1.2.3.4`). Returns null for anything that is
 * not a well-formed IPv6 address, so the caller can refuse rather than guess.
 * @param addr - A lower-case IPv6 literal without brackets.
 */
function parseIpv6Words(addr: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(addr) || addr.split('::').length > 2) {
    return null;
  }
  const [headText, tailText] = addr.includes('::') ? addr.split('::') as [string, string] : [addr, null];
  const headGroups = headText === '' ? [] : headText.split(':');
  const tailGroups = tailText === null || tailText === '' ? [] : tailText.split(':');
  const lastGroup = (tailText === null ? headGroups : tailGroups).at(-1);
  const trailingWords: number[] = [];
  if (lastGroup?.includes('.')) {
    const octets = lastGroup.split('.');
    if (octets.length !== 4 || octets.some(o => !/^\d{1,3}$/.test(o) || Number(o) > 255)) {
      return null;
    }
    const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
    trailingWords.push(a * 256 + b, c * 256 + d);
    (tailText === null ? headGroups : tailGroups).pop();
  }
  const groups = [...headGroups, ...tailGroups];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }
  const wordCount = groups.length + trailingWords.length;
  const head = headGroups.map(g => Number.parseInt(g, 16));
  const tail = tailGroups.map(g => Number.parseInt(g, 16));
  if (tailText === null) {
    return wordCount === 8 ? [...head, ...trailingWords] : null;
  }
  if (wordCount > 7) {
    return null;
  }
  return [...head, ...Array.from<number>({ length: 8 - wordCount }).fill(0), ...tail, ...trailingWords];
}

/**
 * Writes two 16-bit words back out as dotted IPv4 so the IPv4 rules can judge them.
 * @param high - The upper word.
 * @param low - The lower word.
 */
function wordsToIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xFF}.${low >> 8}.${low & 0xFF}`;
}

/**
 * Judge an IPv6 address from its eight words. Addresses that carry an IPv4
 * address inside (mapped, translated, compatible, NAT64, 6to4) are judged by that IPv4
 * address, because a router will deliver them to it.
 * @param words - Eight 16-bit words.
 */
function isPrivateIpv6Words(words: number[]): boolean {
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [number, number, number, number, number, number, number, number];
  const firstFourZero = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0;
  if (firstFourZero && w4 === 0 && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1)) {
    return true; // :: and ::1
  }
  if (firstFourZero && w4 === 0 && (w5 === 0xFFFF || w5 === 0)) {
    return isPrivateAddress(wordsToIpv4(w6, w7)); // ::ffff:0:0/96 mapped, ::/96 compatible
  }
  if (firstFourZero && w4 === 0xFFFF && w5 === 0) {
    return isPrivateAddress(wordsToIpv4(w6, w7)); // ::ffff:0:0:0/96 IPv4-translated (RFC 2765 SIIT)
  }
  if (w0 === 0x64 && w1 === 0xFF9B) {
    if (w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
      return isPrivateAddress(wordsToIpv4(w6, w7)); // 64:ff9b::/96 NAT64
    }
    if (w2 === 1) {
      return true; // 64:ff9b:1::/48 local-use NAT64
    }
  }
  if (w0 === 0x2002) {
    return isPrivateAddress(wordsToIpv4(w1, w2)); // 6to4
  }
  return (w0 === 0x2001 && (w1 === 0 || w1 === 0x0DB8)) // Teredo, documentation
    || (w0 === 0x100 && w1 === 0 && w2 === 0 && w3 === 0) // discard-only
    || (w0 & 0xFFC0) === 0xFEC0 // fec0::/10 deprecated site-local
    || (w0 & 0xFE00) === 0xFC00 // fc00::/7 unique-local
    || (w0 & 0xFFC0) === 0xFE80 // fe80::/10 link-local
    || (w0 & 0xFF00) === 0xFF00; // ff00::/8 multicast
}

/**
 * True for an address a public client could not reach: loopback, link-local
 * (including the cloud metadata address 169.254.169.254), private and
 * carrier-grade ranges, multicast, reserved, and the IPv6 equivalents. IPv6
 * is read in every spelling (hex or dotted tail, `::` anywhere) because
 * `new URL` rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`.
 * @param ip - A numeric address, v4 or v6. Anything unparseable counts as private.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (addr.includes(':')) {
    const words = parseIpv6Words(addr);
    return words === null || isPrivateIpv6Words(words);
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
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''); // `localhost.` is `localhost`
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
