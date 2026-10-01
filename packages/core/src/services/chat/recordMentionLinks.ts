/**
 * The server half of `libs/chat/recordMentions.ts`: which of the answer's
 * record mentions name a real record in THIS workspace, and the page each
 * opens (`services/objects/recordHref.ts`). A mention that names nothing, or
 * names a record by the wrong kind ("deal 201" when 201 is a request), is
 * left as the answer wrote it — a wrong link is worse than none.
 */

import type { RecordMentionLink } from '@/libs/chat/recordMentions';
import { and, eq, inArray } from 'drizzle-orm';
import { findRecordMentions } from '@/libs/chat/recordMentions';
import { CORE_NOUN_CODES, coreNounOf } from '@/libs/codes';
import { db } from '@/libs/DB';
import { recordHrefFrom } from '@/libs/workspace/recordHref';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { hrefForCode } from '@/services/codeLinks';
import { resolveCode } from '@/services/codes';
import { recordLinksForOrg } from '@/services/objects/recordHref';

/** Never more than this many links per answer — an answer that names more is a list, not prose. */
const MAX_LINKS = 40;

/**
 * The links for an answer's record mentions. Never throws: an answer without
 * its links is still the answer.
 * @param orgId - Tenant.
 * @param text - The finished answer.
 */
export async function recordMentionLinks(orgId: string, text: string): Promise<RecordMentionLink[]> {
  try {
    if (!/#\d|\b\d{1,7}\b/.test(text)) {
      return [];
    }
    const [types, links] = await Promise.all([
      db.select({ slug: businessObjectTypeSchema.slug, label: businessObjectTypeSchema.label }).from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, orgId)),
      recordLinksForOrg(orgId),
    ]);
    // What each type is called: its slug, its label, and the page that opens it
    // ("feature" for a request on the factory's board).
    const namesOf = new Map<string, Set<string>>();
    const norm = (w: string): string => w.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    for (const t of types) {
      namesOf.set(t.slug, new Set([norm(t.slug), norm(t.label)]));
    }
    for (const [slug, template] of links.pages) {
      const page = /\/p\/([^/]+)\/\{id\}$/.exec(template)?.[1];
      if (page) {
        (namesOf.get(slug) ?? namesOf.set(slug, new Set()).get(slug)!).add(norm(page));
      }
    }
    const words = [...namesOf.values()].flatMap(s => [...s]);
    // Codes too — FE-201, RUN-439 (`libs/codes.ts`): the type codes and core's.
    const typeCodes = links.codes ?? new Map<string, string>();
    const prefixes = [...typeCodes.values(), ...Object.values(CORE_NOUN_CODES)];
    const mentions = findRecordMentions(text, words, prefixes).slice(0, MAX_LINKS * 2);
    if (mentions.length === 0) {
      return [];
    }
    const ids = [...new Set(mentions.filter(m => !m.code || !coreNounOf(m.code)).map(m => m.id))];
    const rows = await db
      .select({ id: businessObjectSchema.id, type: businessObjectTypeSchema.slug })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, ids)));
    const typeOf = new Map(rows.map(r => [r.id, r.type]));
    const out = new Map<string, RecordMentionLink>();
    for (const m of mentions) {
      if (m.code && coreNounOf(m.code)) {
        // A run, an ask, a conversation: linked only when it is this workspace's.
        const resolved = out.has(m.text.toLowerCase()) ? null : await resolveCode(orgId, m.text);
        if (resolved && resolved.kind !== 'none') {
          out.set(m.text.toLowerCase(), { text: m.text, href: await hrefForCode(orgId, resolved) });
        }
        continue;
      }
      const type = typeOf.get(m.id);
      if (!type) {
        continue;
      }
      // A code links only when its prefix is the record's type's: FE-295 is not plan 295.
      if (m.code && typeCodes.get(type) !== m.code) {
        continue;
      }
      if (m.word !== null && !namesOf.get(type)?.has(norm(m.word)) && !namesOf.get(type)?.has(norm(m.word).replace(/s$/, ''))) {
        continue;
      }
      const key = m.text.toLowerCase();
      if (!out.has(key)) {
        out.set(key, { text: m.text, href: recordHrefFrom(links, { objectType: type, id: m.id }) });
      }
      if (out.size >= MAX_LINKS) {
        break;
      }
    }
    return [...out.values()];
  } catch (err) {
    console.warn('record mention links failed; the answer keeps its plain mentions', { orgId, message: (err as Error).message });
    return [];
  }
}
