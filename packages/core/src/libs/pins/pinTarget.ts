/**
 * PINNED OBJECTS — the one shape for "keep this in my sidebar".
 *
 * Founder, 2026-10-09: "can I get ability to Pin artifacts/wikis/chats/data
 * rooms to favorites? that show up in my sidebar?" The sidebar already pinned
 * nav sections (`features/dashboard/nav/navPins.ts`, the `user_nav_pref` row);
 * an object pin is the same thing, a string in the same ordered `pins` list,
 * so one list holds both and one drag orders both. Nothing new in the schema.
 *
 * A pin stores only WHAT it points at, never its title or link: those are
 * read live on every load (`services/pins/PinService.ts`), so a renamed chat
 * shows its new name, and a pin whose target was deleted, or that the person
 * can no longer open, simply does not come back. Pins live per (workspace,
 * person), the row's own key, so Personal's pins show in Personal.
 *
 * Pure and client-safe: the server, the sidebar, the ⌘K palette and the
 * agent's tool all read this file.
 */

/** Every kind of thing a person can pin. One word each; the sidebar's icon is chosen by it. */
export const PIN_KINDS = ['conversation', 'artifact', 'wiki', 'room', 'view', 'record', 'page'] as const;

export type PinKind = typeof PIN_KINDS[number];

/** What a pin points at. `id` is the row id, or a slug where the thing has no number (a view, an app page, a wiki page). */
export type PinTarget = { kind: PinKind; id: string };

/** A pin as the sidebar draws it: the target, its live title and where it opens. */
export type ResolvedPin = PinTarget & { key: string; title: string; href: string };

const OBJECT_PREFIX = 'pin:';
const PAGE_PREFIX = '/dashboard/p/';
/** A slug, or a wiki page's `<page>/<slug>`. Numbers for rows. Never a path that leaves the app. */
const ID_SHAPE = /^[\w-]+(?:\/[\w-]+)?$/;

export function isPinKind(value: unknown): value is PinKind {
  return typeof value === 'string' && (PIN_KINDS as readonly string[]).includes(value);
}

/**
 * The string stored in `user_nav_pref.pins` for a target. An app page keeps
 * the key the nav already used for it (`/dashboard/p/<slug>`), so a page
 * pinned before this change and one pinned from its header are one pin.
 * @param target - What to pin.
 */
export function pinKey(target: PinTarget): string {
  return target.kind === 'page' ? `${PAGE_PREFIX}${target.id}` : `${OBJECT_PREFIX}${target.kind}:${target.id}`;
}

/**
 * The target a stored pin names, or null for a nav-section pin (a URL) or
 * anything malformed.
 * @param key - One entry of the pins list.
 */
export function parsePinKey(key: string): PinTarget | null {
  if (key.startsWith(OBJECT_PREFIX)) {
    const rest = key.slice(OBJECT_PREFIX.length);
    const colon = rest.indexOf(':');
    const kind = rest.slice(0, colon);
    const id = rest.slice(colon + 1);
    return colon > 0 && isPinKind(kind) && kind !== 'page' && ID_SHAPE.test(id) ? { kind, id } : null;
  }
  const page = /^\/dashboard\/p\/([\w-]+)$/.exec(key);
  return page ? { kind: 'page', id: page[1]! } : null;
}

/**
 * True for a pin that names an object (not a nav section and not an app page, which the nav already lists).
 * @param key
 */
export function isObjectPinKey(key: string): boolean {
  return key.startsWith(OBJECT_PREFIX) && parsePinKey(key) !== null;
}

/**
 * What a dashboard path is ABOUT, when it is one thing a person could pin:
 * a conversation, an artifact, a data room, a record, an app page or a page
 * of one. The workspace (`/w/<slug>`) and locale prefixes are ignored. A
 * `/dashboard/p/<page>/<id>` with a numeric id is a record; with a slug it is
 * a wiki page — the server checks which before it pins (`targetForPath`).
 * @param path - A pathname, with or without query.
 */
export function pinTargetFromPath(path: string): PinTarget | null {
  const p = path.split(/[?#]/)[0]!.replace(/^\/[a-z]{2}(?=\/)/, '').replace(/^\/w\/[\w-]+/, '').replace(/\/$/, '');
  const one = (re: RegExp) => re.exec(p)?.[1] ?? null;
  const chat = one(/^\/dashboard\/chat\/(\d+)$/);
  if (chat) {
    return { kind: 'conversation', id: chat };
  }
  const artifact = one(/^\/dashboard\/artifacts\/(\d+)(?:\/open)?$/);
  if (artifact) {
    return { kind: 'artifact', id: artifact };
  }
  const room = one(/^\/dashboard\/rooms\/(\d+)$/);
  if (room) {
    return { kind: 'room', id: room };
  }
  const record = one(/^\/dashboard\/objects\/(\d+)$/);
  if (record) {
    return { kind: 'record', id: record };
  }
  const sub = /^\/dashboard\/p\/([\w-]+)\/([\w-]+)$/.exec(p);
  if (sub) {
    const [, page, id] = sub;
    if (page === 'runs') {
      return null;
    }
    return /^\d+$/.test(id!) ? { kind: 'record', id: id! } : { kind: 'wiki', id: `${page}/${id}` };
  }
  const page = one(/^\/dashboard\/p\/([\w-]+)$/);
  return page ? { kind: 'page', id: page } : null;
}

/** The most pins one person keeps in one workspace, nav sections and objects together. */
export const MAX_PINS = 60;

/** How many pinned rows the sidebar shows before "More…". */
export const PINNED_SHOWN = 8;

/**
 * Add a pin at the end (pin order is pin time); already pinned is a no-op.
 * @param pins - The stored list.
 * @param key - The pin to add.
 */
export function addPin(pins: readonly string[], key: string): string[] {
  return pins.includes(key) ? [...pins] : [...pins, key];
}

/**
 * Remove a pin; not pinned is a no-op.
 * @param pins - The stored list.
 * @param key - The pin to remove.
 */
export function removePin(pins: readonly string[], key: string): string[] {
  return pins.filter(p => p !== key);
}

/**
 * Move a pin to a place in the list the person SEES. The stored list can
 * hold pins the sidebar does not draw (a deleted target, a page this person
 * cannot open), so a drop at visible index 2 means "just before what is now
 * third on screen", not stored index 2. Unknown keys change nothing.
 * @param pins - The stored list.
 * @param visible - The keys the sidebar draws, in order.
 * @param key - The pin being moved.
 * @param toVisibleIndex - Where it lands among the visible ones.
 */
export function movePinWithin(pins: readonly string[], visible: readonly string[], key: string, toVisibleIndex: number): string[] {
  if (!pins.includes(key) || !visible.includes(key)) {
    return [...pins];
  }
  const others = visible.filter(k => k !== key);
  const index = Math.max(0, Math.min(toVisibleIndex, others.length));
  const next = pins.filter(p => p !== key);
  if (index >= others.length) {
    // After the last visible one: right behind it, so hidden pins keep their places.
    const last = others[others.length - 1];
    next.splice(last === undefined ? next.length : next.indexOf(last) + 1, 0, key);
    return next;
  }
  next.splice(next.indexOf(others[index]!), 0, key);
  return next;
}
