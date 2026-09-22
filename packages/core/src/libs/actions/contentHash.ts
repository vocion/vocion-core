/**
 * The hash a per-send approval is recorded against — the ONE definition, used
 * by the approve route and by the surface that draws the check.
 *
 * A check is derived, never stored as a boolean: approving a send stores this
 * hash, and the tab is checked only while the hash still matches the copy on
 * screen. That is what makes a check self-invalidating — a regeneration or an
 * inline edit changes the copy, the hash stops matching, and the check clears
 * with no clearing logic anywhere and no field for the dedup refresh to
 * remember to wipe.
 *
 * Which is exactly why there can only be one implementation. If the route
 * hashed what it received and the client hashed what it renders by a different
 * rule, every check would read stale and the walk could never complete. Both
 * call sites import this function, and `contentHash.test.ts` pins them to the
 * same output.
 *
 * Not a cryptographic digest on purpose: this detects change, it does not
 * resist an adversary, and the client needs it synchronously during render
 * (Web Crypto's SHA-256 is async). 64 bits of FNV-1a over the same bytes, in
 * hex.
 */

const OFFSET_LO = 0x84222325;
const OFFSET_HI = 0x0000_01B3 ^ 0xCBF2_9CE4; // seeded so the two lanes differ

/**
 * Hash the copy a reviewer approved: subject and body, trimmed, joined by a
 * separator no subject line can forge on its own.
 *
 * Trimmed because trailing whitespace is not a change a reviewer made — a
 * textarea adding a newline must not silently uncheck a send they approved.
 * An absent subject and an empty one are the same copy, so both hash alike.
 * @param subject - The subject line, absent for a kind that has none.
 * @param body - The body as it is on screen.
 * @returns A stable 16-character hex digest.
 */
export function contentHash(subject: string | undefined, body: string): string {
  const text = `${(subject ?? '').trim()}\u0000${body.trim()}`;
  let lo = OFFSET_LO >>> 0;
  let hi = OFFSET_HI >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    lo = Math.imul(lo ^ c, 0x0100_0193) >>> 0;
    hi = Math.imul(hi ^ (c + i), 0x01B3_7F09) >>> 0;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}
