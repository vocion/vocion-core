/**
 * The shared vendor request: every refusal becomes a sentence a person acts
 * on, a 429 is waited out rather than retried early, and no credential ends
 * up in a message.
 */
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { basicAuth, htmlToText, orThrow, textToHtml, vendorReason, vendorRequest } from './vendorRequest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vendorRequest', () => {
  it('parses a JSON answer and sends JSON with its content type', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ hello: 'northwind' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await vendorRequest<{ hello: string }>({ vendor: 'Zendesk', url: 'https://northwind.zendesk.example/x', json: { a: 1 }, headers: { authorization: 'Bearer tok_1' } });

    expect(res).toMatchObject({ ok: true, data: { hello: 'northwind' } });

    const init = fetchMock.mock.calls[0]![1]!;

    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('turns a 401 into a refusal with the vendor\'s reason and the fix, never the credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Couldn\'t authenticate you' }), { status: 401 })));

    const res = await vendorRequest({ vendor: 'Zendesk', url: 'https://northwind.zendesk.example/x', headers: { authorization: 'Basic c2VjcmV0' }, authHint: 'Check the API token.' });

    expect(res).toMatchObject({ ok: false, kind: 'unauthorized', status: 401 });
    expect(!res.ok && res.message).toBe('Zendesk refused the credential (HTTP 401: Couldn\'t authenticate you). Check the API token.');
    expect(!res.ok && res.message).not.toContain('c2VjcmV0');
  });

  it('waits out a 429 as asked, then gives up with a sentence', async () => {
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await vendorRequest({ vendor: 'Linear', url: 'https://api.linear.example/graphql', maxRetries: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ ok: false, kind: 'rate_limited', message: 'Linear is rate limiting this credential; try again in a minute.' });
  });

  it('says so when the vendor did not answer, and reads bytes and text when asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    await expect(vendorRequest({ vendor: 'Box', url: 'https://api.box.example' })).resolves.toMatchObject({ ok: false, kind: 'unreachable', message: 'Box did not answer: fetch failed' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('plain words', { status: 200 })));
    const text = await vendorRequest<string>({ vendor: 'GitLab', url: 'https://gitlab.example/raw', read: 'text' });

    expect(orThrow(text)).toBe('plain words');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const bytes = await vendorRequest<Uint8Array>({ vendor: 'Dropbox', url: 'https://content.dropbox.example', read: 'bytes' });

    expect([...orThrow(bytes)]).toEqual([1, 2, 3]);
    expect(() => orThrow({ ok: false, kind: 'not_found', status: 404, message: 'GitLab has nothing there (HTTP 404).' })).toThrow('GitLab has nothing there');
  });
});

describe('the small helpers', () => {
  it('finds the reason in the shapes vendors answer with', () => {
    expect(vendorReason('{"errors":[{"message":"Entity not found"}]}')).toBe('Entity not found');
    expect(vendorReason('{"error":{"message":"bad token"}}')).toBe('bad token');
    expect(vendorReason('<html>gateway</html>')).toBe('<html>gateway</html>');
    expect(vendorReason('')).toBe('');
  });

  it('flattens HTML to text and back', () => {
    expect(htmlToText('<p>Hello <b>Dana</b></p><ul><li>one</li><li>two &amp; three</li></ul>')).toBe('Hello Dana\n- one\n- two & three');
    expect(textToHtml('Hi Dana,\n\nThe <fix> shipped.\nThanks')).toBe('<p>Hi Dana,</p><p>The &lt;fix&gt; shipped.<br>Thanks</p>');
    expect(basicAuth('ops@northwind.example/token', 'tok')).toBe(`Basic ${Buffer.from('ops@northwind.example/token:tok').toString('base64')}`);
  });
});
