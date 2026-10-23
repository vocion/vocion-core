import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(String(secret), salt, 32).toString('hex')}`;
}

export function verifySecret(secret, stored) {
  if (!stored) {
    return false;
  }
  const [, salt, hash] = String(stored).split(':');
  const given = scryptSync(String(secret), salt, 32);
  return timingSafeEqual(given, Buffer.from(hash, 'hex'));
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}
