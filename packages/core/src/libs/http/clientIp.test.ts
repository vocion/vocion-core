import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from './clientIp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientIp', () => {
  it('reads the address the one trusted proxy recorded, not the one the client wrote', () => {
    // The client sent a made-up hop; Caddy appended the real peer after it.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.4' });

    expect(clientIp(headers)).toBe('198.51.100.4');
  });

  it('counts further from the right when more proxies are trusted', () => {
    vi.stubEnv('VOCION_TRUSTED_PROXY_COUNT', '2');
    // client-chosen, real client, CDN edge (as the load balancer saw it)
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.4, 192.0.2.10' });

    expect(clientIp(headers)).toBe('198.51.100.4');
  });

  it('takes the only entry of a short chain', () => {
    vi.stubEnv('VOCION_TRUSTED_PROXY_COUNT', '3');

    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });

  it('answers null with no forwarding header, so per-IP limits skip rather than pool everyone', () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': ' , ' }))).toBeNull();
  });
});
