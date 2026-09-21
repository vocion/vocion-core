import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchImage, ImageFetchError } from './remote';

// `.example` never resolves, by design (RFC 2606), so the guard's DNS step is
// given a public answer and the guard's own refusals are tested separately in
// `libs/net/publicUrl.test.ts`.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async (host: string) => (host === 'localhost' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])) }));

/**
 * The network is stubbed; sharp is real, because "it came back small enough
 * to inline" is the whole point and a fake encoder would not prove it.
 * @param body
 * @param init
 * @param init.status
 * @param init.headers
 */
const respond = (body: Buffer | string, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: init.status ?? 200, headers: init.headers ?? {} });

const serve = (fn: (url: string) => Response) => vi.stubGlobal('fetch', vi.fn((input: string | URL) => Promise.resolve(fn(String(input)))));

const bigPng = async (edge: number) => sharp({ create: { width: edge, height: edge, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImage', () => {
  it('downscales a large PNG to a data URI a document can hold, and says what size it is now', async () => {
    const source = await bigPng(1600);
    serve(() => respond(source, { headers: { 'content-type': 'image/png' } }));

    const got = await fetchImage('https://northwind.example/logo.png', { maxEdge: 240 });

    expect(got.kind).toBe('png');
    expect(got.width).toBe(240);
    expect(got.height).toBe(240);
    expect(got.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(got.bytes.byteLength).toBeLessThan(source.byteLength);
    expect(got.sourceBytes).toBe(source.byteLength);
  });

  it('keeps an SVG as an SVG and reads its size off the viewBox', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><rect width="300" height="80"/></svg>';
    serve(() => respond(svg, { headers: { 'content-type': 'image/svg+xml' } }));

    const got = await fetchImage('https://northwind.example/mark.svg');

    expect(got.kind).toBe('svg');
    expect(got).toMatchObject({ width: 300, height: 80, contentType: 'image/svg+xml' });
    expect(got.dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('refuses an SVG carrying script rather than sanitising it', async () => {
    serve(() => respond('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/steal")</script></svg>', { headers: { 'content-type': 'image/svg+xml' } }));

    await expect(fetchImage('https://northwind.example/mark.svg')).rejects.toThrow(/carries script/);
  });

  it('refuses the login page a logo URL redirected to, and says to find the image\'s own URL', async () => {
    serve(() => respond('<!DOCTYPE html><html><body>Sign in</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));

    await expect(fetchImage('https://northwind.example/logo.png')).rejects.toThrow(/HTML page/);
  });

  it('refuses a body over the cap before it has buffered it', async () => {
    const source = await bigPng(400);
    serve(() => respond(source, { headers: { 'content-type': 'image/png' } }));

    await expect(fetchImage('https://northwind.example/hero.png', { maxFetchBytes: 64 })).rejects.toThrow(/cap/);
  });

  it('refuses a private address, a file:// path and a redirect into one — without fetching', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(respond('')));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchImage('file:///etc/passwd')).rejects.toThrow(ImageFetchError);
    await expect(fetchImage('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private or loopback/);
    expect(fetchSpy).not.toHaveBeenCalled();

    serve(url => (url.includes('northwind') ? respond('', { status: 302, headers: { location: 'http://127.0.0.1:9000/logo.png' } }) : respond('')));

    await expect(fetchImage('https://northwind.example/logo.png')).rejects.toThrow(/private or loopback/);
  });

  it('refuses an ICO, because a favicon is not a logo', async () => {
    serve(() => respond(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), { headers: { 'content-type': 'image/x-icon' } }));

    await expect(fetchImage('https://northwind.example/favicon.ico')).rejects.toThrow(/favicon container/);
  });

  it('reports the HTTP status rather than inventing a reason', async () => {
    serve(() => respond('nope', { status: 404 }));

    await expect(fetchImage('https://northwind.example/logo.png')).rejects.toThrow(/HTTP 404/);
  });
});
