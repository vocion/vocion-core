import type { PinTarget, ResolvedPin } from '@/libs/pins/pinTarget';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isObjectPinKey, MAX_PINS, parsePinKey, pinKey, pinTargetFromPath } from '@/libs/pins/pinTarget';
import { canOpenArtifact } from '@/libs/share/audience';
import { artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, userNavPrefSchema } from '@/models/Schema';
import { visibleToViewer } from '@/services/ConversationService';

/**
 * The server half of pinned objects (`libs/pins/pinTarget.ts`): pin, unpin,
 * and read each pin's title and link LIVE, with this person's own access.
 *
 * Pins are entries in `user_nav_pref.pins` — the list the sidebar's section
 * pins already live in — so no table was added. One row per (workspace,
 * person) is also the scoping rule: a pin made in Personal shows in Personal.
 *
 * A pin is never trusted on the way out. Every load re-reads its target in
 * this workspace, as this viewer, and a target that is gone or that they can
 * no longer open is left out without a word: the sidebar is not the place
 * to report a deletion. The stored entry stays, so access that comes back
 * brings the pin back with it.
 */

type Who = { orgId: string; userId: string };

/** Why a pin could not be made, said for a person. */
export class PinError extends Error {}

/**
 * Read every object pin's title and link, as this person, in pin order.
 * Pins whose target was deleted or is out of their reach are left out.
 * Nav-section pins (URLs) and app pages are the sidebar's own and are
 * skipped here. Each kind reads in one query, and a kind that fails to read
 * drops only its own pins.
 * @param who - The workspace and the person.
 * @param who.orgId - The workspace (`project.id`).
 * @param who.userId - The person.
 * @param keys - Stored pin keys.
 */
export async function resolvePins(who: Who, keys: readonly string[]): Promise<ResolvedPin[]> {
  const targets = keys.filter(isObjectPinKey).map(k => parsePinKey(k)!);
  const ids = (kind: PinTarget['kind']) => targets.filter(t => t.kind === kind).map(t => t.id);
  const numeric = (kind: PinTarget['kind']) => ids(kind).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  const found = new Map<string, ResolvedPin>();
  const put = (target: PinTarget, title: string, href: string) => {
    const key = pinKey(target);
    found.set(key, { ...target, key, title: title.trim() || 'Untitled', href });
  };
  const safely = async (read: () => Promise<void>) => {
    try {
      await read();
    } catch (error) {
      console.warn('pins: could not read one kind', error);
    }
  };

  await Promise.all([
    safely(async () => {
      const wanted = numeric('conversation');
      if (wanted.length === 0) {
        return;
      }
      const rows = await db
        .select({ id: conversationSchema.id, title: conversationSchema.title })
        .from(conversationSchema)
        .where(and(eq(conversationSchema.orgId, who.orgId), inArray(conversationSchema.id, wanted), visibleToViewer(who.userId)));
      rows.forEach(r => put({ kind: 'conversation', id: String(r.id) }, r.title, `/dashboard/chat/${r.id}`));
    }),
    safely(async () => {
      const wanted = numeric('artifact');
      if (wanted.length === 0) {
        return;
      }
      const rows = await db
        .select({ id: artifactSchema.id, title: artifactSchema.title, audience: artifactSchema.shareAudience, ownerId: artifactSchema.shareOwnerId })
        .from(artifactSchema)
        .where(and(eq(artifactSchema.orgId, who.orgId), inArray(artifactSchema.id, wanted)));
      rows
        .filter(r => canOpenArtifact({ audience: r.audience, ownerId: r.ownerId ?? null }, { userId: who.userId, isMember: true, hasToken: false }))
        .forEach(r => put({ kind: 'artifact', id: String(r.id) }, r.title, `/dashboard/artifacts/${r.id}`));
    }),
    safely(async () => {
      const wanted = [...new Set([...numeric('room'), ...numeric('record')])];
      if (wanted.length === 0) {
        return;
      }
      const rows = await db
        .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug })
        .from(businessObjectSchema)
        .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
        .where(and(eq(businessObjectSchema.orgId, who.orgId), inArray(businessObjectSchema.id, wanted)));
      const [{ DATA_ROOM_TYPE, roomHref }, { recordHref }] = await Promise.all([import('@/services/DataRoomService'), import('@/services/objects/recordHref')]);
      const rooms = new Set(ids('room'));
      const records = new Set(ids('record'));
      for (const r of rows) {
        if (rooms.has(String(r.id)) && r.type === DATA_ROOM_TYPE) {
          put({ kind: 'room', id: String(r.id) }, r.title, roomHref(r.id));
        }
        if (records.has(String(r.id))) {
          const href = r.type === DATA_ROOM_TYPE ? roomHref(r.id) : await recordHref(who.orgId, { objectType: r.type, id: r.id }).catch(() => `/dashboard/objects/${r.id}`);
          put({ kind: 'record', id: String(r.id) }, r.title, href);
        }
      }
    }),
    safely(async () => {
      const wanted = ids('view');
      if (wanted.length === 0) {
        return;
      }
      const { viewsFor } = await import('@/services/state/state');
      const views = await viewsFor({ orgId: who.orgId, userId: who.userId });
      for (const v of views.filter(x => wanted.includes(x.slug))) {
        // A view has no page of its own: it opens as the ask that runs it.
        put({ kind: 'view', id: v.slug }, v.name, `/dashboard/chat?ask=${encodeURIComponent(`Show my "${v.name}" view`)}`);
      }
    }),
    safely(async () => {
      const byPage = new Map<string, string[]>();
      for (const id of ids('wiki')) {
        const [page, slug] = id.split('/');
        if (page && slug) {
          byPage.set(page, [...(byPage.get(page) ?? []), slug]);
        }
      }
      for (const [page, slugs] of byPage) {
        const folder = await wikiFolderOf(page, who.orgId);
        if (!folder) {
          continue;
        }
        const { loadWikiReadingPages } = await import('@/services/wiki/wikiReading');
        for (const p of (await loadWikiReadingPages(who.orgId, folder)).filter(x => slugs.includes(x.slug))) {
          put({ kind: 'wiki', id: `${page}/${p.slug}` }, p.title, `/dashboard/p/${page}/${p.slug}`);
        }
      }
    }),
  ]);

  return keys.map(k => found.get(k)).filter((p): p is ResolvedPin => p !== undefined);
}

/**
 * The artifact folder a wiki page reads, or null when the slug is not a wiki page here.
 * @param page - The page slug.
 * @param orgId - The workspace.
 */
async function wikiFolderOf(page: string, orgId: string): Promise<string | null> {
  const { readPageForOrg } = await import('@/services/PluginService');
  const manifest = await readPageForOrg(page, orgId);
  return manifest?.archetype === 'wiki' && manifest.source?.kind === 'artifacts' && manifest.source.folder ? manifest.source.folder : null;
}

/**
 * What a path in this workspace is, as a pin target: `pinTargetFromPath`,
 * with a `/dashboard/p/<page>/<slug>` checked against the page's manifest so
 * a slug-addressed record page is never taken for a wiki.
 * @param orgId - The workspace.
 * @param path - The page's path.
 */
export async function targetForPath(orgId: string, path: string): Promise<PinTarget | null> {
  const target = pinTargetFromPath(path);
  if (target?.kind !== 'wiki') {
    return target;
  }
  const [page] = target.id.split('/');
  return page && await wikiFolderOf(page, orgId) ? target : null;
}

async function storedPins(who: Who): Promise<string[]> {
  const [row] = await db
    .select({ pins: userNavPrefSchema.pins })
    .from(userNavPrefSchema)
    .where(and(eq(userNavPrefSchema.orgId, who.orgId), eq(userNavPrefSchema.userId, who.userId)))
    .limit(1);
  return row?.pins ?? [];
}

export type PinResult = { pin: ResolvedPin | null; pins: string[]; changed: boolean };

/**
 * Pin a target for this person in this workspace, at the end of their list.
 * Refuses, with a sentence, a target they cannot open here or a full list.
 * Pinning what is already pinned changes nothing and says so (`changed`).
 * @param who - The workspace and the person.
 * @param who.orgId - The workspace.
 * @param who.userId - The person.
 * @param target - What to pin.
 */
export async function pinObject(who: Who, target: PinTarget): Promise<PinResult> {
  const key = pinKey(target);
  // An app page is the nav's own row; anything else must be one this person can open here.
  const [pin] = target.kind === 'page' ? [null] : await resolvePins(who, [key]);
  if (target.kind !== 'page' && !pin) {
    throw new PinError('That is not something you can open in this workspace, so it cannot be pinned here.');
  }
  const before = await storedPins(who);
  if (before.includes(key)) {
    return { pin: pin ?? null, pins: before, changed: false };
  }
  if (before.length >= MAX_PINS) {
    throw new PinError(`Your sidebar already holds ${MAX_PINS} pins. Unpin one first.`);
  }
  const one = JSON.stringify([key]);
  const [row] = await db
    .insert(userNavPrefSchema)
    .values({ orgId: who.orgId, userId: who.userId, pins: [key] })
    .onConflictDoUpdate({
      target: [userNavPrefSchema.orgId, userNavPrefSchema.userId],
      // Appended in the database, so a pin made elsewhere in the same moment is kept.
      set: {
        pins: sql`case when ${userNavPrefSchema.pins} @> ${one}::jsonb then ${userNavPrefSchema.pins} else ${userNavPrefSchema.pins} || ${one}::jsonb end`,
        updatedAt: new Date(),
      },
    })
    .returning({ pins: userNavPrefSchema.pins });
  return { pin: pin ?? null, pins: row?.pins ?? [...before, key], changed: true };
}

/**
 * Unpin by stored key. Not pinned changes nothing.
 * @param who - The workspace and the person.
 * @param who.orgId - The workspace.
 * @param who.userId - The person.
 * @param key - The stored pin.
 */
export async function unpinKey(who: Who, key: string): Promise<{ pins: string[]; changed: boolean }> {
  const before = await storedPins(who);
  if (!before.includes(key)) {
    return { pins: before, changed: false };
  }
  const [row] = await db
    .update(userNavPrefSchema)
    .set({ pins: sql`${userNavPrefSchema.pins} - ${key}::text`, updatedAt: new Date() })
    .where(and(eq(userNavPrefSchema.orgId, who.orgId), eq(userNavPrefSchema.userId, who.userId)))
    .returning({ pins: userNavPrefSchema.pins });
  return { pins: row?.pins ?? before.filter(p => p !== key), changed: true };
}
