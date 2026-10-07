/**
 * What Sentry may send. A deployment hosting several companies sends all their
 * errors to one Sentry project, so the defaults are the private ones, each
 * widening is an opt-in, and the scrub runs whatever is opted into: a session
 * cookie, an API token or an invite link is never PII an operator chose.
 */
import { describe, expect, it } from 'vitest';
import { sentryOptions } from './options';

const defaults = sentryOptions({});

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

describe('the scrub before an event leaves', () => {
  it('drops cookies, body and query string, and keeps only headers that name no one', () => {
    const sent = defaults.init.beforeSend(eventWithRequest());

    expect(sent.request).toEqual({
      method: 'POST',
      url: 'https://app.example.com/api/v1/invites/accept',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'host': 'app.example.com' },
    });
    expect(JSON.stringify(sent)).not.toMatch(/secret|hunter2|oauth-code|203\.0\.113\.7/);
  });

  it('scrubs whatever PII is opted into, and transactions the same way', () => {
    const open = sentryOptions({ sendDefaultPii: '1' });

    for (const scrub of [open.init.beforeSend, open.init.beforeSendTransaction]) {
      expect(JSON.stringify(scrub(eventWithRequest()))).not.toMatch(/secret|hunter2|oauth-code/);
    }
  });

  it('leaves an event with no request, and everything else on the event, as it was', () => {
    const bare = { event_id: 'evt-2', message: 'no request here', tags: { org: 'proj-northwind' }, request: undefined };

    expect(defaults.init.beforeSend(bare)).toBe(bare);
    expect(defaults.init.beforeSend(eventWithRequest())).toMatchObject({ event_id: 'evt-1', message: 'boom' });
  });
});
