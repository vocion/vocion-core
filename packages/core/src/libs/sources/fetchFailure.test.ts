/**
 * What a failed fetch keeps about itself. The allowlist is the privacy line
 * (a cookie must never reach a stored run), every read is bounded, and none of
 * it may throw: a description that fails hides the failure it describes.
 */
import { describe, expect, it } from 'vitest';
import { describeHttpFailure } from './fetchFailure';

const encoder = new TextEncoder();

/**
 * Whether text holds a line break, tab, other control character or an undecodable byte.
 * @param text - the text to check.
 */
function hasNoise(text: string): boolean {
  return [...text].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7F || c.charCodeAt(0) === 0xFFFD);
}

/**
 * A body served in chunks, counting how many bytes were pulled from it.
 * @param chunk - the bytes of every chunk.
 * @param chunks - how many chunks the body holds.
 */
function countedStream(chunk: Uint8Array, chunks: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let sent = 0;
  let bytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      sent += 1;
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  }, { highWaterMark: 0 });
  return { stream, pulled: () => bytes };
}

describe('describeHttpFailure', () => {
  it('keeps the allowlisted headers and the block page title, and never a cookie', async () => {
    const res = new Response('<html><head><title>Attention Required! | Edge</title></head><body>Blocked</body></html>', {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'server': 'edge-proxy',
        'cf-ray': '8f00aa11bb22cc33-ORD',
        'cf-mitigated': 'challenge',
        'set-cookie': '__session=abc123; Path=/; HttpOnly',
        'x-request-secret': 'nope',
      },
    });

    const { message, detail } = await describeHttpFailure(res);

    expect(detail).toEqual({
      status: 403,
      headers: { 'server': 'edge-proxy', 'cf-ray': '8f00aa11bb22cc33-ORD', 'cf-mitigated': 'challenge' },
      title: 'Attention Required! | Edge',
    });
    expect(message).toBe('HTTP 403 · server: edge-proxy · cf-ray: 8f00aa11bb22cc33-ORD · cf-mitigated: challenge · title: Attention Required! | Edge');
    expect(JSON.stringify({ message, detail })).not.toMatch(/cookie|__session|abc123|x-request-secret/i);
  });

  it('is exactly `HTTP 500` when the answer says nothing else', async () => {
    const { message, detail } = await describeHttpFailure(new Response(null, { status: 500 }));

    expect(message).toBe('HTTP 500');
    expect(detail).toEqual({ status: 500, headers: {} });
  });

  it('falls back to the start of the text when the page has no title', async () => {
    const markup = `<html><head><script>var x = 1;</script><style>p{}</style></head><body><h1>Access   denied</h1>\n<p>${'Your request was refused. '.repeat(40)}</p></body></html>`;
    const { message, detail } = await describeHttpFailure(new Response(markup, { status: 403, headers: { 'content-type': 'text/html' } }));

    expect(detail.title).toBeUndefined();
    expect(detail.snippet?.startsWith('Access denied Your request was refused.')).toBe(true);
    expect(detail.snippet).not.toContain('var x');
    expect(detail.snippet!.length).toBeLessThanOrEqual(300);
    expect(message.startsWith('HTTP 403 · body: Access denied')).toBe(true);
  });

  it('reads a plain-text body as a snippet', async () => {
    const { message } = await describeHttpFailure(new Response('gone\n\n  for good', { status: 410 }));

    expect(message).toBe('HTTP 410 · body: gone for good');
  });

  it('stays one line whatever the page puts in its title or headers', async () => {
    const res = new Response('<title>Line one\r\nLine two\tand\u0000three</title>', {
      status: 503,
      headers: { 'content-type': 'text/html', 'retry-after': '120', 'via': '1.1 cache-a,\t1.1 cache-b' },
    });

    const { message } = await describeHttpFailure(res);

    expect(hasNoise(message)).toBe(false);
    expect(message).toBe('HTTP 503 · via: 1.1 cache-a, 1.1 cache-b · retry-after: 120 · title: Line one Line two and three');
  });

  it('never splits an emoji at the 300-character cut, so Postgres jsonb accepts the detail', async () => {
    const text = `${'x'.repeat(298)}😀 tail`;
    const plain = await describeHttpFailure(new Response(text, { status: 403, headers: { 'content-type': 'text/plain' } }));
    const html = await describeHttpFailure(new Response(`<title>${text}</title>`, { status: 403, headers: { 'content-type': 'text/html' } }));

    for (const { message, detail } of [plain, html]) {
      expect(message.isWellFormed()).toBe(true);
      expect(JSON.stringify(detail)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
    }

    expect(plain.detail.snippet).toBe(`${'x'.repeat(298)}😀…`);
    expect(html.detail.title).toBe(`${'x'.repeat(298)}😀…`);
  });

  it('cuts a 5 kB header value to 200 characters', async () => {
    const res = new Response(null, { status: 403, headers: { server: 'x'.repeat(5000) } });

    const { message, detail } = await describeHttpFailure(res);

    expect(detail.headers.server).toHaveLength(200);
    expect(message.length).toBeLessThan(220);
  });

  it('reads at most 64 KiB of a 10 MB body', async () => {
    const chunk = encoder.encode('a'.repeat(16 * 1024));
    const { stream, pulled } = countedStream(chunk, 640);

    const { detail } = await describeHttpFailure(new Response(stream, { status: 500, headers: { 'content-type': 'text/plain' } }));

    expect(pulled()).toBeLessThanOrEqual(64 * 1024);
    expect(detail.snippet).toHaveLength(300);
  });

  it('does not throw on a binary body labelled as text, and keeps none of its noise', async () => {
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 37) % 256;
    }
    const { message } = await describeHttpFailure(new Response(bytes, { status: 502, headers: { 'content-type': 'text/html' } }));

    expect(message.startsWith('HTTP 502')).toBe(true);
    expect(hasNoise(message)).toBe(false);
  });

  it('does not read a body whose type is not text', async () => {
    const { stream, pulled } = countedStream(encoder.encode('PNG'), 10);

    const { message } = await describeHttpFailure(new Response(stream, { status: 404, headers: { 'content-type': 'image/png', 'x-cache': 'Error from cloudfront' } }));

    expect(message).toBe('HTTP 404 · x-cache: Error from cloudfront');
    expect(pulled()).toBe(0);
  });

  it('still answers `HTTP <status>` with its headers when the body stream throws', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<title>Half'));
        controller.error(new Error('socket hang up'));
      },
    });

    const { message, detail } = await describeHttpFailure(new Response(stream, { status: 403, headers: { 'content-type': 'text/html', 'x-amzn-waf-action': 'block' } }));

    expect(detail.status).toBe(403);
    expect(message.startsWith('HTTP 403 · x-amzn-waf-action: block')).toBe(true);
  });
});
