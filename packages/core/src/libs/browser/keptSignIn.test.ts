/**
 * A kept sign-in's shape, checked before anything is sealed: only the
 * connector's domains, refused whole, never trimmed. Every site, cookie and
 * value here is fictional.
 */
import { describe, expect, it } from 'vitest';
import { checkSignInState, hostAllowed, keepOnly, keptSignInSpecFor, mergeSignIn, SIGN_IN_FILE_KIND } from './keptSignIn';

const SQ = ['squarespace.com'];

function cookie(domain: string, name = 'crumb', value = 'fixture-value-1') {
  return { name, value, domain, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
}

const session = {
  cookies: [cookie('login.squarespace.com'), cookie('.squarespace.com', 'member'), cookie('example-site.squarespace.com', 'site'), cookie('.example-site.squarespace.com', 'ss_cvr')],
  origins: [{ origin: 'https://example-site.squarespace.com', localStorage: [{ name: 'editor.seen', value: 'true' }] }],
};

describe('which connectors keep a sign-in', () => {
  it('Squarespace does, on squarespace.com; a connector with an API does not', () => {
    expect(keptSignInSpecFor('squarespace')).toMatchObject({ vendor: 'Squarespace', domains: ['squarespace.com'] });
    expect(keptSignInSpecFor('github')).toBeNull();
    expect(keptSignInSpecFor(null)).toBeNull();
  });

  it('matches a domain and what is under it, never a look-alike', () => {
    for (const host of ['squarespace.com', '.squarespace.com', 'login.squarespace.com', 'example-site.squarespace.com']) {
      expect(hostAllowed(host, SQ)).toBe(true);
    }
    for (const host of ['notsquarespace.com', 'squarespace.com.northwind-home.example', 'northwind-home.example', '']) {
      expect(hostAllowed(host, SQ)).toBe(false);
    }
  });
});

describe('a session sent from outside', () => {
  it('is taken bare, or in the file the CLI writes', () => {
    expect(checkSignInState(session, SQ)).toMatchObject({ ok: true, value: { cookies: expect.any(Array) } });

    const file = { kind: SIGN_IN_FILE_KIND, site: 'https://example-site.squarespace.com', savedAt: '2026-10-27T12:00:00.000Z', savedFrom: 'the operator CLI', state: session };
    const checked = checkSignInState(file, SQ);

    expect(checked.ok && checked.value.cookies).toHaveLength(4);
  });

  it('is refused whole when one cookie is for another site, naming it', () => {
    const checked = checkSignInState({ ...session, cookies: [...session.cookies, cookie('.northwind-home.example', 'tracker')] }, SQ);

    expect(checked).toMatchObject({ ok: false, field: 'state.cookies[4].domain' });
    expect(!checked.ok && checked.why).toContain('.northwind-home.example');
  });

  it('is refused when its storage is for another site, or not https', () => {
    expect(checkSignInState({ ...session, origins: [{ origin: 'https://northwind-home.example', localStorage: [] }] }, SQ)).toMatchObject({ ok: false, field: 'state.origins[0].origin' });
    expect(checkSignInState({ ...session, origins: [{ origin: 'http://example-site.squarespace.com', localStorage: [] }] }, SQ)).toMatchObject({ ok: false });
  });

  it('is refused when it is not a storage state, or holds no cookie', () => {
    expect(checkSignInState('a string', SQ)).toMatchObject({ ok: false, field: 'state' });
    expect(checkSignInState({ cookies: [] }, SQ)).toMatchObject({ ok: false, field: 'state.cookies' });
    expect(checkSignInState({ cookies: [{ domain: 'squarespace.com' }] }, SQ)).toMatchObject({ ok: false, field: 'state.cookies[0]' });
  });
});

describe('a run\'s browser, saved back', () => {
  it('keeps only the connector\'s domains: the person\'s other sites stay out', () => {
    const kept = keepOnly({ cookies: [...session.cookies, cookie('.northwind-home.example', 'other')], origins: [...session.origins, { origin: 'https://northwind-home.example', localStorage: [{ name: 'a', value: 'b' }] }] }, SQ);

    expect(kept.cookies.map(c => c.domain)).toEqual(session.cookies.map(c => c.domain));
    expect(kept.origins.map(o => o.origin)).toEqual(['https://example-site.squarespace.com']);
  });
});

describe('a kept sign-in laid over a browser', () => {
  it('replaces the browser\'s cookies of the same name, domain and path, and keeps the rest', () => {
    const base = { cookies: [cookie('.squarespace.com', 'member', 'stale'), cookie('.northwind-home.example', 'other')], origins: [{ origin: 'https://example-site.squarespace.com', localStorage: [{ name: 'old', value: '1' }] }] };
    const merged = mergeSignIn(base, { cookies: [cookie('squarespace.com', 'member', 'fresh')], origins: session.origins });

    expect(merged.cookies.map(c => `${c.name}=${c.value}`)).toEqual(['other=fixture-value-1', 'member=fresh']);
    expect(merged.origins).toEqual(session.origins);
  });
});
