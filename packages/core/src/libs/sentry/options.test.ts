/**
 * What Sentry may send. A deployment hosting several companies sends all their
 * errors to one Sentry project, so the defaults are the private ones, each
 * widening is an opt-in, and the scrub runs whatever is opted into: a session
 * cookie, an API token, an invite link or an OAuth code is never PII an
 * operator chose.
 *
 * The SDK copies a request's URL into far more places than `event.request`, so
 * the fixtures below are shaped the way `@sentry/nextjs` 10.42 builds them: the
 * root http.server span's trace data, Next's `request_path` from
 * `captureRequestError`, client and resource spans, and navigation, fetch and
 * console breadcrumbs.
 */
import { describe, expect, it } from 'vitest';
import { sentryOptions } from './options';

const defaults = sentryOptions({});
const withPii = sentryOptions({ sendDefaultPii: '1' });

/** Every secret a fixture below carries, and the address that is PII. */
const SECRETS = /inv_secret|oauth-code|session-secret|vcn_live_secret|hunter2|sig-secret|state-secret/;
const CLIENT_IP = /203\.0\.113\.7/;

/** An error event the way the Node SDK hands it to `beforeSend`, request attached. */
function eventWithRequest() {
  return {
    event_id: 'evt-1',
    message: 'boom',
    request: {
      method: 'POST',
      url: 'https://app.example.com/api/v1/invites/accept?token=inv_secret#frag',
      query_string: 'token=inv_secret',
      cookies: { 'authjs.session-token': 'session-secret' },
      data: '{"password":"hunter2"}',
      headers: {
        'Authorization': 'Bearer vcn_live_secret',
        'Cookie': 'authjs.session-token=session-secret',
        'X-Forwarded-For': '203.0.113.7',
        'Referer': 'https://app.example.com/w/revenue?code=oauth-code',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'host': 'app.example.com',
      },
    },
  };
}

/**
 * A server error reported through Next's `onRequestError` on an OAuth callback:
 * `request_path` is Next's `request.path`, query included.
 */
function oauthCallbackError() {
  return {
    event_id: 'evt-3',
    exception: { values: [{ type: 'Error', value: 'callback failed' }] },
    transaction: 'GET /api/connect/[connector]/callback',
    contexts: {
      nextjs: {
        request_path: '/api/connect/northwind-crm/callback?code=oauth-code&state=state-secret',
        router_kind: 'App Router',
        router_path: '/api/connect/[connector]/callback',
        route_type: 'route',
      },
      trace: { trace_id: 'trace-1', span_id: 'span-1' },
    },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/sign-up?invite=inv_secret', to: '/w/revenue' } },
      { category: 'console', level: 'log', message: 'accepting inv_secret', data: { arguments: ['accepting', 'inv_secret'], logger: 'console' } },
    ],
  };
}

/** A sampled transaction for `/sign-up?invite=…`, as the http.server root span and its children leave it. */
function signUpTransaction() {
  return {
    type: 'transaction',
    transaction: 'GET /sign-up',
    request: { method: 'GET', url: 'https://app.example.com/sign-up?invite=inv_secret', query_string: 'invite=inv_secret' },
    contexts: {
      trace: {
        trace_id: 'trace-2',
        span_id: 'span-root',
        op: 'http.server',
        data: {
          'sentry.op': 'http.server',
          'http.method': 'GET',
          'http.url': 'https://app.example.com/sign-up?invite=inv_secret',
          'http.target': '/sign-up?invite=inv_secret',
          'http.query': '?invite=inv_secret',
          'http.host': 'app.example.com',
          'http.client_ip': '203.0.113.7',
          'net.peer.ip': '203.0.113.7',
          'client.address': '203.0.113.7',
          'http.user_agent': 'Mozilla/5.0',
          'http.request.header.user_agent': 'Mozilla/5.0',
          'http.request.header.referer': 'https://app.example.com/w/revenue?code=oauth-code',
          'http.request.header.x_forwarded_for': '203.0.113.7',
          'http.request.header.cookie.authjs_session_token': '[Filtered]',
          'http.route': '/sign-up',
        },
      },
    },
    spans: [
      {
        span_id: 'span-fetch',
        op: 'http.client',
        description: 'GET https://api.example.com/v1/invites?token=inv_secret',
        data: {
          'url': 'https://api.example.com/v1/invites?token=inv_secret',
          'http.url': 'https://api.example.com/v1/invites?token=inv_secret',
          'url.full': 'https://api.example.com/v1/invites?token=inv_secret',
          'url.query': 'token=inv_secret',
          'http.query': '?token=inv_secret',
          'http.fragment': '#frag',
          'server.address': 'api.example.com',
        },
      },
      {
        span_id: 'span-img',
        op: 'resource.img',
        description: 'https://media.example.com/northwind/logo.png?X-Amz-Signature=sig-secret',
        data: { 'server.address': 'media.example.com' },
      },
      {
        span_id: 'span-db',
        op: 'db',
        description: 'select "id" from "project" where "slug" = ? limit ?',
        data: { 'db.system': 'postgresql' },
      },
    ],
  };
}

describe('sentryOptions defaults', () => {
  it('sends no default PII, traces one request in ten, ships no logs and masks replays', () => {
    expect(defaults.init).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0.1, enableLogs: false });
    expect(defaults.replayMasking).toEqual({ maskAllText: true, maskAllInputs: true, blockAllMedia: true });
  });

  it('widens each one only when its variable opts in', () => {
    const open = sentryOptions({ sendDefaultPii: 'true', tracesSampleRate: '0.25', enableLogs: '1' });

    expect(open.init).toMatchObject({ sendDefaultPii: true, tracesSampleRate: 0.25, enableLogs: true });
    expect(open.replayMasking).toEqual({ maskAllText: false, maskAllInputs: false, blockAllMedia: false });
  });

  it('reads a rate it cannot use as the default rather than as zero or everything', () => {
    for (const raw of ['', ' ', 'all', '-0.5', '1.5', 'NaN']) {
      expect(sentryOptions({ tracesSampleRate: raw }).init.tracesSampleRate).toBe(0.1);
    }

    expect(sentryOptions({ tracesSampleRate: '0' }).init.tracesSampleRate).toBe(0);
    expect(sentryOptions({ tracesSampleRate: '1' }).init.tracesSampleRate).toBe(1);
  });

  it('treats anything but 1 or true as off', () => {
    for (const raw of ['0', 'false', 'yes', '', undefined]) {
      expect(sentryOptions({ sendDefaultPii: raw, enableLogs: raw }).init).toMatchObject({ sendDefaultPii: false, enableLogs: false });
    }
  });
});

describe('the request on an event', () => {
  it('drops cookies, body and query string, and keeps only headers that name no one', () => {
    const sent = defaults.init.beforeSend(eventWithRequest());

    expect(sent.request).toEqual({
      method: 'POST',
      url: 'https://app.example.com/api/v1/invites/accept',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'host': 'app.example.com' },
    });
    expect(JSON.stringify(sent)).not.toMatch(SECRETS);
    expect(JSON.stringify(sent)).not.toMatch(CLIENT_IP);
  });

  it('is scrubbed the same way with PII opted into', () => {
    expect(JSON.stringify(withPii.init.beforeSend(eventWithRequest()))).not.toMatch(SECRETS);
  });

  it('leaves an event with no request, and everything else on the event, as it was', () => {
    const bare = { event_id: 'evt-2', message: 'no request here', tags: { org: 'proj-northwind' }, request: undefined };

    expect(defaults.init.beforeSend(bare)).toEqual(bare);
    expect(defaults.init.beforeSend(eventWithRequest())).toMatchObject({ event_id: 'evt-1', message: 'boom' });
  });
});

describe('an error reported through Next\'s onRequestError', () => {
  it('keeps the path Next saw without the OAuth code and state', () => {
    const sent = defaults.init.beforeSend(oauthCallbackError());

    expect(sent.contexts.nextjs).toEqual({
      request_path: '/api/connect/northwind-crm/callback',
      router_kind: 'App Router',
      router_path: '/api/connect/[connector]/callback',
      route_type: 'route',
    });
    expect(sent.contexts.trace).toEqual({ trace_id: 'trace-1', span_id: 'span-1' });
    expect(JSON.stringify(sent)).not.toMatch(SECRETS);
  });

  it('carries its breadcrumbs without the query, and without console output', () => {
    const sent = defaults.init.beforeSend(oauthCallbackError());

    expect(sent.breadcrumbs).toEqual([{ category: 'navigation', data: { from: '/sign-up', to: '/w/revenue' } }]);
  });
});

describe('a sampled transaction', () => {
  it('ships no invite token, OAuth code, signature or client address anywhere on it', () => {
    const sent = defaults.init.beforeSendTransaction(signUpTransaction());

    expect(JSON.stringify(sent)).not.toMatch(SECRETS);
    expect(JSON.stringify(sent)).not.toMatch(CLIENT_IP);
  });

  it('keeps the root span\'s URL and target as a path, and only the headers a request keeps', () => {
    const { data } = defaults.init.beforeSendTransaction(signUpTransaction()).contexts.trace;

    expect(data).toEqual({
      'sentry.op': 'http.server',
      'http.method': 'GET',
      'http.url': 'https://app.example.com/sign-up',
      'http.target': '/sign-up',
      'http.host': 'app.example.com',
      'http.user_agent': 'Mozilla/5.0',
      'http.request.header.user_agent': 'Mozilla/5.0',
      'http.route': '/sign-up',
    });
  });

  it('strips the query from client and resource spans, and leaves a database span\'s placeholders alone', () => {
    const [fetch, image, query] = defaults.init.beforeSendTransaction(signUpTransaction()).spans;

    expect(fetch).toEqual({
      span_id: 'span-fetch',
      op: 'http.client',
      description: 'GET https://api.example.com/v1/invites',
      data: {
        'url': 'https://api.example.com/v1/invites',
        'http.url': 'https://api.example.com/v1/invites',
        'url.full': 'https://api.example.com/v1/invites',
        'server.address': 'api.example.com',
      },
    });
    expect(image!.description).toBe('https://media.example.com/northwind/logo.png');
    expect(query!.description).toBe('select "id" from "project" where "slug" = ? limit ?');
  });

  it('keeps the client address only when PII is opted into, and never the query', () => {
    const sent = withPii.init.beforeSendTransaction(signUpTransaction());

    expect(sent.contexts.trace.data).toMatchObject({ 'http.client_ip': '203.0.113.7', 'net.peer.ip': '203.0.113.7', 'client.address': '203.0.113.7' });
    expect(JSON.stringify(sent)).not.toMatch(SECRETS);
  });
});

describe('breadcrumbs as they are recorded', () => {
  const crumbs = {
    navigation: { category: 'navigation', data: { from: '/sign-up?invite=inv_secret#welcome', to: '/w/revenue?code=oauth-code' } },
    fetch: { category: 'fetch', type: 'http', data: { method: 'POST', url: 'https://app.example.com/api/invites/accept?token=inv_secret', status_code: 200 } },
    xhr: { category: 'xhr', type: 'http', data: { method: 'GET', url: '/api/connect/northwind-crm/callback?code=oauth-code', status_code: 302 } },
    http: { category: 'http', type: 'http', data: { 'url': 'https://api.example.com/v1/invites', 'http.method': 'GET', 'http.query': '?token=inv_secret', 'http.fragment': '#frag' } },
    console: { category: 'console', level: 'log', message: 'invite inv_secret accepted', data: { arguments: ['invite', 'inv_secret', 'accepted'], logger: 'console' } },
    click: { category: 'ui.click', message: 'button.accept-invite' },
  } as const;

  it('keep where navigation went from and to, without the query', () => {
    expect(defaults.init.beforeBreadcrumb(crumbs.navigation)).toEqual({ category: 'navigation', data: { from: '/sign-up', to: '/w/revenue' } });
  });

  it('keep the URL a fetch, xhr or http call went to, without the query', () => {
    expect(defaults.init.beforeBreadcrumb(crumbs.fetch)?.data).toEqual({ method: 'POST', url: 'https://app.example.com/api/invites/accept', status_code: 200 });
    expect(defaults.init.beforeBreadcrumb(crumbs.xhr)?.data).toEqual({ method: 'GET', url: '/api/connect/northwind-crm/callback', status_code: 302 });
    expect(defaults.init.beforeBreadcrumb(crumbs.http)?.data).toEqual({ 'url': 'https://api.example.com/v1/invites', 'http.method': 'GET' });
  });

  it('drop console output, whose message is the logged arguments, unless PII is opted into', () => {
    expect(defaults.init.beforeBreadcrumb(crumbs.console)).toBeNull();
    expect(withPii.init.beforeBreadcrumb(crumbs.console)).toEqual(crumbs.console);
  });

  it('carry no secret whichever way PII is set, and leave the rest as they were', () => {
    for (const options of [defaults, withPii]) {
      for (const crumb of [crumbs.navigation, crumbs.fetch, crumbs.xhr, crumbs.http]) {
        expect(JSON.stringify(options.init.beforeBreadcrumb(crumb))).not.toMatch(SECRETS);
      }
    }

    expect(defaults.init.beforeBreadcrumb(crumbs.click)).toBe(crumbs.click);
  });
});
