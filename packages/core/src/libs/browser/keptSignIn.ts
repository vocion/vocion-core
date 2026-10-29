/**
 * A KEPT SIGN-IN: the browser state of a site a person signed in to by hand
 * (its cookies and site storage, as Playwright's `storageState` holds them),
 * kept on a connection so the browser runs that publish to that site start
 * signed in instead of typing a password.
 *
 * Why it exists. Some sites refuse a password typed by a browser in a data
 * centre: Squarespace answered "The username or password is incorrect" to
 * the browser container on Vocion Cloud for an email and password that
 * signed in fine from a laptop, and the cookies of that laptop's session
 * opened the site's editor from the same container. So the person signs in
 * where the site trusts them (their own machine, 2FA and all), and the
 * session is carried over, sealed under the workspace's key.
 *
 * Pure and client-safe: which connectors keep one and for which domains, the
 * check every upload passes, and the merge a run's browser makes. The store
 * is `services/browser/keptSignIn.ts`.
 */

/** One cookie, as Playwright reads and writes it. */
export type SignInCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since the epoch; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

/** One origin's site storage. */
export type SignInOrigin = { origin: string; localStorage: Array<{ name: string; value: string }> };

/** A browser's sign-in, in Playwright's `storageState` shape. */
export type SignInState = { cookies: SignInCookie[]; origins: SignInOrigin[] };

/** The file the operator's CLI writes with `--out`, and the app's upload takes. */
export type SignInFile = {
  kind: typeof SIGN_IN_FILE_KIND;
  /** The site it was made for, e.g. https://example-site.squarespace.com. */
  site: string;
  savedAt: string;
  /** Where it was made, in words: "the operator CLI on a laptop". */
  savedFrom: string;
  state: SignInState;
};

export const SIGN_IN_FILE_KIND = 'vocion-sign-in/1';

/** What a connector's kept sign-in may hold: the domains its cookies and storage belong to. */
export type KeptSignInSpec = {
  /** The vendor, as a person reads it: "Squarespace". */
  vendor: string;
  /** Registrable domains; a host matches one when it is the domain or under it. */
  domains: string[];
  /** The page a person signs in at, under the site's address. */
  signInPath: string;
};

/**
 * The connectors that keep a sign-in, by connector slug: the one place this
 * is written down, read by the store, the routes, the publish runs and the
 * connector page.
 */
const KEEPS_SIGN_IN: Record<string, KeptSignInSpec> = {
  // Squarespace has no API for posts and refuses a password typed from a data centre.
  squarespace: { vendor: 'Squarespace', domains: ['squarespace.com'], signInPath: '/config' },
};

/**
 * The kept sign-in a connector takes, or null when it takes none.
 * @param connectorSlug - The connector, e.g. `squarespace`.
 */
export function keptSignInSpecFor(connectorSlug: string | null | undefined): KeptSignInSpec | null {
  return (connectorSlug && KEEPS_SIGN_IN[connectorSlug]) || null;
}

/** The most a kept sign-in may hold: far above a real one (17 cookies), far below abuse. */
export const SIGN_IN_LIMITS = { cookies: 200, origins: 20, storageItems: 200, bytes: 1_000_000 } as const;

/**
 * Whether a host is one of the domains, or under one: `squarespace.com`,
 * `.squarespace.com` and `example-site.squarespace.com` match `squarespace.com`;
 * `squarespace.com.example` and `notsquarespace.com` do not.
 * @param host - A cookie's domain or a URL's host.
 * @param domains - The registrable domains.
 */
export function hostAllowed(host: string, domains: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/^\./, '');
  return Boolean(h) && domains.some((d) => {
    const domain = d.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  });
}

/**
 * A URL's host, or null when it is not an http(s) URL.
 * @param url - The URL.
 */
export function httpHostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

type Checked<T> = { ok: true; value: T } | { ok: false; why: string; field: string };

const SAME_SITE = new Set(['Strict', 'Lax', 'None']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkCookie(raw: unknown, i: number, domains: readonly string[]): Checked<SignInCookie> {
  const field = `cookies[${i}]`;
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name || typeof raw.value !== 'string' || typeof raw.domain !== 'string') {
    return { ok: false, why: `Cookie ${i + 1} needs a name, a value and a domain.`, field };
  }
  if (!hostAllowed(raw.domain, domains)) {
    return { ok: false, why: `Cookie ${i + 1} ("${raw.name.slice(0, 40)}") is for ${raw.domain.slice(0, 80)}; a kept sign-in holds cookies for ${domains.join(', ')} only.`, field: `${field}.domain` };
  }
  const sameSite = typeof raw.sameSite === 'string' && SAME_SITE.has(raw.sameSite) ? raw.sameSite as SignInCookie['sameSite'] : 'Lax';
  return {
    ok: true,
    value: {
      name: raw.name,
      value: raw.value,
      domain: raw.domain,
      path: typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : '/',
      expires: typeof raw.expires === 'number' && Number.isFinite(raw.expires) ? raw.expires : -1,
      httpOnly: raw.httpOnly === true,
      secure: raw.secure === true,
      sameSite,
    },
  };
}

function checkOrigin(raw: unknown, i: number, domains: readonly string[]): Checked<SignInOrigin> {
  const field = `origins[${i}]`;
  if (!isRecord(raw) || typeof raw.origin !== 'string') {
    return { ok: false, why: `Site storage ${i + 1} needs an origin.`, field };
  }
  const host = httpHostOf(raw.origin);
  if (!host || !raw.origin.startsWith('https://')) {
    return { ok: false, why: `Site storage ${i + 1} is for ${raw.origin.slice(0, 80)}, which is not an https:// address.`, field: `${field}.origin` };
  }
  if (!hostAllowed(host, domains)) {
    return { ok: false, why: `Site storage ${i + 1} is for ${host}; a kept sign-in holds storage for ${domains.join(', ')} only.`, field: `${field}.origin` };
  }
  const items = Array.isArray(raw.localStorage) ? raw.localStorage : [];
  if (items.length > SIGN_IN_LIMITS.storageItems) {
    return { ok: false, why: `Site storage ${i + 1} holds ${items.length} items; at most ${SIGN_IN_LIMITS.storageItems}.`, field: `${field}.localStorage` };
  }
  const localStorage: SignInOrigin['localStorage'] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.value !== 'string') {
      return { ok: false, why: `Site storage ${i + 1} has an item without a name and a value.`, field: `${field}.localStorage` };
    }
    localStorage.push({ name: item.name, value: item.value });
  }
  return { ok: true, value: { origin: new URL(raw.origin).origin, localStorage } };
}

/**
 * A browser state taken from outside (the operator's CLI, an uploaded file),
 * checked: Playwright's `storageState` shape, every cookie and every origin on
 * the connector's domains, within the limits. Refused whole, never trimmed,
 * so what is kept is exactly what was sent. Accepts the bare state or the
 * CLI's file around it (`SignInFile`).
 * @param raw - What was sent.
 * @param domains - The connector's domains (`KeptSignInSpec.domains`).
 */
export function checkSignInState(raw: unknown, domains: readonly string[]): Checked<SignInState> {
  const state = isRecord(raw) && raw.kind === SIGN_IN_FILE_KIND && isRecord(raw.state) ? raw.state : raw;
  if (!isRecord(state) || !Array.isArray(state.cookies)) {
    return { ok: false, why: 'A session is a browser\'s storage state: an object with a cookies list (and, optionally, origins).', field: 'state' };
  }
  if (JSON.stringify(state).length > SIGN_IN_LIMITS.bytes) {
    return { ok: false, why: `The session is larger than ${SIGN_IN_LIMITS.bytes / 1_000_000} MB; a sign-in is a few kilobytes.`, field: 'state' };
  }
  if (state.cookies.length === 0) {
    return { ok: false, why: 'The session has no cookies: sign in to the site first, then save it.', field: 'state.cookies' };
  }
  if (state.cookies.length > SIGN_IN_LIMITS.cookies) {
    return { ok: false, why: `The session holds ${state.cookies.length} cookies; at most ${SIGN_IN_LIMITS.cookies}.`, field: 'state.cookies' };
  }
  const origins = Array.isArray(state.origins) ? state.origins : [];
  if (origins.length > SIGN_IN_LIMITS.origins) {
    return { ok: false, why: `The session holds storage for ${origins.length} sites; at most ${SIGN_IN_LIMITS.origins}.`, field: 'state.origins' };
  }
  const out: SignInState = { cookies: [], origins: [] };
  for (const [i, c] of state.cookies.entries()) {
    const checked = checkCookie(c, i, domains);
    if (!checked.ok) {
      return { ...checked, field: `state.${checked.field}` };
    }
    out.cookies.push(checked.value);
  }
  for (const [i, o] of origins.entries()) {
    const checked = checkOrigin(o, i, domains);
    if (!checked.ok) {
      return { ...checked, field: `state.${checked.field}` };
    }
    out.origins.push(checked.value);
  }
  return { ok: true, value: out };
}

/**
 * Only the part of a browser's state that belongs to these domains: what a
 * run's browser saves back to a kept sign-in. A person's browser is shared by
 * their runs, so it may hold any site's cookies; none but these are kept.
 * @param state - The browser's whole state.
 * @param state.cookies - Its cookies, in Playwright's shape.
 * @param state.origins - Its site storage.
 * @param domains - The connector's domains.
 */
export function keepOnly(state: { cookies: ReadonlyArray<Partial<SignInCookie>>; origins?: ReadonlyArray<{ origin: string; localStorage: Array<{ name: string; value: string }> }> }, domains: readonly string[]): SignInState {
  const cookies: SignInCookie[] = [];
  for (const [i, c] of state.cookies.entries()) {
    if (typeof c.domain === 'string' && hostAllowed(c.domain, domains)) {
      const checked = checkCookie(c, i, domains);
      if (checked.ok) {
        cookies.push(checked.value);
      }
    }
  }
  const origins = (state.origins ?? []).filter((o) => {
    const host = httpHostOf(o.origin);
    return Boolean(host && o.origin.startsWith('https://') && hostAllowed(host, domains));
  }).map(o => ({ origin: o.origin, localStorage: o.localStorage.map(i => ({ name: i.name, value: i.value })) }));
  return { cookies, origins };
}

/**
 * A browser's state with a kept sign-in laid over it: the kept cookies replace
 * the browser's own of the same name, domain and path, and the kept storage
 * replaces the browser's storage for the same origin. Everything else the
 * browser held is left as it was.
 * @param base - The browser's state now.
 * @param base.cookies - Its cookies.
 * @param base.origins - Its site storage.
 * @param kept - The kept sign-in.
 */
export function mergeSignIn<C extends { name: string; domain: string; path: string }, O extends { origin: string }>(base: { cookies: C[]; origins: O[] }, kept: SignInState): { cookies: Array<C | SignInCookie>; origins: Array<O | SignInOrigin> } {
  const key = (c: { name: string; domain: string; path: string }) => `${c.name}\u0000${c.domain.replace(/^\./, '').toLowerCase()}\u0000${c.path}`;
  const keptKeys = new Set(kept.cookies.map(key));
  const keptOrigins = new Set(kept.origins.map(o => o.origin));
  return {
    cookies: [...base.cookies.filter(c => !keptKeys.has(key(c))), ...kept.cookies],
    origins: [...base.origins.filter(o => !keptOrigins.has(o.origin)), ...kept.origins],
  };
}

/** A kept sign-in as a connector's page reads it: never the cookies, only when, where from and whether it still works. */
export type KeptSignInStatus = {
  kept: boolean;
  site: string | null;
  savedAt: string | null;
  savedFrom: string | null;
  cookies: number;
  /** The site showed its sign-in page to a run and would not take the password: a person signs in again. */
  needsSignIn: { at: string; why: string } | null;
};

/**
 * `knowledge_source.kept_sign_in` as stored: the state sealed under the
 * workspace's key (the vault's AES-GCM, as a browser run's checkpoint is),
 * and beside it, in the clear, what the connector's page shows.
 */
export type KeptSignInColumn = {
  sealed: { ciphertext: string; nonce: string; authTag: string; dekId: number } | null;
  site: string | null;
  savedAt: string | null;
  savedFrom: string | null;
  savedBy: string | null;
  cookies: number;
  needsSignIn: { at: string; why: string } | null;
};
