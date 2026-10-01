import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { parseCode, recordCode } from '@/libs/codes';
import { listBusinessObjects } from '@/services/BusinessObjectService';
import { typeCodesForOrg } from '@/services/codes';
import { objectKnowledge } from '@/services/MemoryService';
import { recordLinkerForOrg } from '@/services/objects/recordHref';
import { liveStatusOf } from './readObject';
import { recordIdArg, recordIdOf } from './recordIdArg';

/**
 * How many records a lookup reads the delivery status of. Each is the feature
 * report's own read, so a long list says where to read it instead of paying
 * for twenty.
 */
const STATUS_READS = 6;

// Metadata keys that are plumbing, not answer material — never surfaced to the
// model. They invite verbatim dumps: internal ids, deep-links, profile URLs.
const NOISE_KEY = /(?:^|_)(?:id|ids|url|urls|link|links|slug)$|linkedin/i;
const isUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v);

function compactValue(v: unknown): string {
  // An object is written as JSON, not "[object Object]" (2026-09-26: a task's
  // checks and qa read as "[object Object], [object Object]").
  const one = (x: unknown): string => (x && typeof x === 'object' ? JSON.stringify(x) : String(x ?? ''));
  const s = Array.isArray(v) ? (v as unknown[]).map(one).join(', ') : one(v);
  return s.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * A `where` value, with a code (FE-132) read as its record's id.
 * @param v
 */
function idOrValue(v: string | number | boolean): string {
  const parsed = typeof v === 'string' ? parseCode(v) : null;
  return parsed?.prefix ? String(parsed.id) : String(v);
}

/**
 * lookup_objects — list the structured business objects the agent can see.
 *
 * Returns a COMPACT, sanitized digest: human fields only, no internal ids, no
 * deep-links (/dashboard/objects/…), no profile URLs. It is DATA for the agent
 * to synthesize into a plain-language answer, never to paste back verbatim —
 * pasting the raw record is the exact anti-pattern that dumps ugly field lists
 * into chat. (An eval guard asserts responses never contain "/dashboard/objects/".)
 * @param ctx
 */
export function lookupObjectsTool(ctx: RuntimeContext) {
  const available = ctx.objectTypeSlugs.join(', ');
  return tool(
    async (args) => {
      // One record by its code (FE-294) or id, checked against its type's code.
      const byId = args.id === undefined ? null : await recordIdOf(ctx.orgId, args.id);
      if (byId && 'reason' in byId) {
        return `${byId.reason}.`;
      }
      const all = await listBusinessObjects(ctx.orgId, args.type_slug);
      const codes = await typeCodesForOrg(ctx.orgId).catch(() => null);
      // NARROW BEFORE READING (red team, 2026-09-26). Every lookup returned
      // every record of the type — 61 requests, every plan — as one JSON
      // blob, and the PM answered "there is no plan for #132" with plan #134
      // (requestId 132) sitting in the result. A lookup by id, by field or by
      // words returns the few records asked about, and a long list says how
      // many it held back instead of burying them.
      const where = Object.entries(args.where ?? {});
      const words = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const matched = all.filter((obj) => {
        if (byId && obj.id !== byId.id) {
          return false;
        }
        const meta = (obj.metadata ?? {}) as Record<string, unknown>;
        // A link field named by code ({ requestId: "FE-132" }) is matched by its id.
        if (!where.every(([k, v]) => String((k === 'status' ? obj.status : meta[k]) ?? '').toLowerCase() === idOrValue(v).toLowerCase())) {
          return false;
        }
        if (words.length > 0) {
          const hay = `${obj.title} ${typeof obj.summary === 'string' ? obj.summary : ''} ${typeof meta.outcome === 'string' ? meta.outcome : ''}`.toLowerCase();
          return words.every(w => hay.includes(w));
        }
        return true;
      });
      const limit = args.limit ?? 25;
      const objects = matched.slice(0, limit);
      if (objects.length === 0) {
        return all.length === 0 ? 'No records found for this type.' : `No ${args.type_slug ?? ''} record matched (${all.length} of that type exist). Loosen the filter or look one up by id.`;
      }
      // Object-scoped approved memory rides the lookup result — the plan's
      // "business objects in play" layer. A client fact reaches the model
      // only on turns that actually touch that client, so it can never leak
      // into another client's context. Refs are `<type slug>/<object id>`.
      const knowledge = await objectKnowledge(
        ctx.orgId,
        objects.map(obj => `${obj.type?.slug ?? 'object'}/${obj.id}`),
      );
      // Return compact JSON, NOT prose. A live turn proved the model happily
      // echoes any human-readable tool output (and even a "synthesize"
      // instruction line) straight into chat. A raw JSON array is data the
      // model won't paste as an answer — it has to read + synthesize it.
      // WHERE EACH ONE IS, FROM THE RECORDS (backlog 044): for a record whose
      // type has a report page, the same You / Now / Next and delivery facts
      // read_object returns — so "what's running" is answered from QA's
      // verdict, the merge and CI, never from a field that only says a run
      // ended. Only for a short list; a long one says to read the few that matter.
      const statuses = objects.length <= STATUS_READS
        ? await Promise.all(objects.map(obj => liveStatusOf(ctx.orgId, obj.id)))
        : [];
      const rows = objects.map((obj, i) => {
        const meta = (obj.metadata ?? {}) as Record<string, unknown>;
        // THE ID, first.
        //
        // `update_object` documents its own `id` parameter as "from
        // lookup_objects" — and lookup_objects has never returned one. So a
        // lead could find a record, reason about it correctly, and then be
        // unable to write anything back to it. A live turn on 2026-09-22 ended
        // exactly there: "the lookup_objects result doesn't include IDs …
        // I don't have the numeric ID", after which it wrote its plan to a
        // wiki page instead of onto the request. Every request on the factory
        // board reading "not recorded" traces to this line.
        //
        // It is the first key because it is what the next tool call needs, and
        // a digest that buries the handle is a digest a model has to hunt in.
        // The CODE beside it: what the answer names the record by (FE-294, `libs/codes.ts`).
        const rec: Record<string, unknown> = { id: obj.id, code: recordCode(codes, obj.type?.slug, obj.id), title: obj.title, status: obj.status };
        if (statuses[i]) {
          rec.liveStatus = statuses[i];
        }
        for (const [k, v] of Object.entries(meta)) {
          if (v == null || NOISE_KEY.test(k) || isUrl(v)) {
            continue;
          }
          rec[k] = compactValue(v);
        }
        if (obj.summary) {
          rec.summary = compactValue(obj.summary);
        }
        const facts = knowledge.get(`${obj.type?.slug ?? 'object'}/${obj.id}`);
        if (facts) {
          // Human-approved facts about THIS record — apply them, they outrank
          // anything inferred from the fields above.
          rec.approved_knowledge = facts;
        }
        return rec;
      });
      // Tracker records ARE grounding — surface them as explorable sources in
      // the drawer (a lookup-only turn previously had an empty Sources drawer,
      // which read as "no citations"). Each opens the record's own page — a
      // release at its release page — where its workspace declares one.
      const link = await recordLinkerForOrg(ctx.orgId);
      ctx.emit({
        type: 'documents',
        documents: objects.slice(0, 30).map(obj => ({
          document_id: `object-${obj.id}`,
          semantic_identifier: obj.title,
          link: link({ objectType: obj.type?.slug, id: obj.id }),
          source_type: 'tracker',
          blurb: [obj.status, typeof obj.summary === 'string' ? obj.summary : ''].filter(Boolean).join(' — ').slice(0, 200),
        })),
      });
      const held = matched.length - objects.length;
      return held > 0
        ? JSON.stringify({ records: rows, showing: rows.length, of: matched.length, note: `${held} more matched; narrow with where, query or id to see them.` })
        : JSON.stringify(rows);
    },
    {
      name: 'lookup_objects',
      description: `Look up the structured business objects (follow-ups, events, deals, accounts) the agent tracks. Returns a compact, sanitized digest to SYNTHESIZE into a plain answer — never paste it back verbatim. When ${STATUS_READS} or fewer records match and their type has a report page, each carries liveStatus: where it is now and its delivery facts (QA's verdict, whether its pull request merged, CI, whether its merge runs itself, the request's stage) — say status from those fields, never from a field that only says a run ended.`,
      schema: z.object({
        type_slug: z.string().optional().describe(`Object type to filter by${available ? ` (available: ${available})` : ''}`),
        id: recordIdArg('One record — the fastest way to read a record you already know').optional(),
        where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Field equals value, e.g. { "requestId": 132 } for the plan of request 132, { "product": "send", "state": "triaged" }. Case-insensitive.'),
        query: z.string().optional().describe('Words that must all appear in the title, summary or outcome.'),
        limit: z.number().int().min(1).max(100).optional().describe('At most this many records (default 25). The reply says how many more matched.'),
      }),
    },
  );
}
