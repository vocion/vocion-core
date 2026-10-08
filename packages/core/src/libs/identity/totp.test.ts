import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, matchTotp, otpauthUri, totpCode, totpStep } from './totp';

// RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('encodes the RFC seed the way authenticator apps read it', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString('ascii')).toBe('12345678901234567890');
  });

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC vector at T=%i', (seconds, code) => {
    // The RFC lists eight digits; six is the same value mod 10^6.
    expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(code);
  });

  it('accepts the code for now and one step either side, and says which step matched', () => {
    const now = new Date(1111111111 * 1000);
    const step = totpStep(now);

    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { now })).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { now })).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { now })).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { now })).toBeNull();
  });

  it('refuses a code at or before the last step accepted, so a seen code cannot be replayed', () => {
    const now = new Date(1111111111 * 1000);
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);

    expect(matchTotp(RFC_SECRET, code, { now, afterStep: step })).toBeNull();
    expect(matchTotp(RFC_SECRET, code, { now, afterStep: step - 1 })).toBe(step);
  });

  it('ignores spaces and refuses anything that is not six digits', () => {
    const now = new Date(59 * 1000);

    expect(matchTotp(RFC_SECRET, '287 082', { now })).not.toBeNull();
    expect(matchTotp(RFC_SECRET, '28708', { now })).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
  });

  it('mints 160-bit secrets', () => {
    const secret = generateTotpSecret();

    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('builds the otpauth URI an app scans', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, issuer: 'Vocion', account: 'sam@northwind.example' });

    expect(uri).toBe('otpauth://totp/Vocion:sam%40northwind.example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Vocion&algorithm=SHA1&digits=6&period=30');
  });
});
