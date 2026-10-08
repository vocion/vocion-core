/**
 * Time-based one-time passwords (RFC 6238), the codes an authenticator app
 * shows. Six digits, a 30-second step, HMAC-SHA1 — the defaults every app
 * (Google Authenticator, 1Password, Authy, Microsoft Authenticator) reads from
 * an `otpauth://` QR code without being told.
 *
 * Pure functions over node:crypto, no dependency: the algorithm is thirty
 * lines, and the parts that matter for security — a constant-time compare and
 * reporting WHICH step matched so the caller can refuse a replay — are easier
 * to see here than inside a library.
 */

import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Steps either side of now that still verify: one, for a clock a little off. */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * RFC 4648 base32, unpadded — the encoding `otpauth://` secrets use.
 * @param bytes - What to encode.
 */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decode unpadded base32, ignoring case, spaces and padding.
 * @param text - The encoded secret.
 */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Not a base32 secret.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 — the length RFC 4226 recommends for SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The step a moment falls in.
 * @param now - The moment.
 */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * The code for one step (RFC 4226 HOTP over the step counter).
 * @param secret - The base32 secret.
 * @param step - The step.
 */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0F;
  const binary = ((digest[offset]! & 0x7F) << 24)
    | (digest[offset + 1]! << 16)
    | (digest[offset + 2]! << 8)
    | digest[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The step a typed code matches, or null when it matches none. Steps at or
 * before `afterStep` never match, so a code accepted once cannot be accepted
 * again inside its own window.
 * @param secret - The base32 secret.
 * @param typed - What the person typed; spaces are ignored.
 * @param opts - Verification options.
 * @param opts.now - The current time.
 * @param opts.afterStep - The last step already accepted, if any.
 */
export function matchTotp(secret: string, typed: string, opts: { now: Date; afterStep?: number | null }): number | null {
  const code = typed.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) {
    return null;
  }
  const current = totpStep(opts.now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    if (opts.afterStep != null && step <= opts.afterStep) {
      continue;
    }
    if (sameCode(totpCode(secret, step), code)) {
      return step;
    }
  }
  return null;
}

/**
 * The `otpauth://` URI an authenticator app reads from the QR code.
 * @param opts - What the app shows.
 * @param opts.secret - The base32 secret.
 * @param opts.issuer - The product name the app lists the entry under.
 * @param opts.account - The person's sign-in, shown under it.
 */
export function otpauthUri(opts: { secret: string; issuer: string; account: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
