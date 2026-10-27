/**
 * record_competitors — who ranks beside a client on Google, recorded on the
 * client's project from searches already made, never guessed.
 *
 * The agent runs `serp_search` for the client's core services (with the city
 * where the business is local) and hands the results pages here by
 * `serpResultId`. Code does the counting (`libs/tools/serp/competitors.ts`):
 * a domain that ranks for two or more of the searches is a competitor;
 * directories, marketplaces and the client's own domains are left out
 * (`libs/tools/serp/directories.ts`). Each competitor is written onto the
 * project with the searches it ranked for, its position and its page, dated.
 *
 * Granted with the `serp` group (it reads what `serp_search` returned), or by
 * name. It spends nothing: the searches were charged when they were made.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { SerpResult } from '@/libs/tools/serp/types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { competitorsFromSerps } from '@/libs/tools/serp/competitors';
import { getDataRoom, projectHref, updateDataRoom } from '@/services/DataRoomService';
import { recall, SERP_GRANT } from './serpResearch';

export const RECORD_COMPETITORS = 'record_competitors';

/** Searches the tool reads at most: enough for a client's core services in a few places. */
const MAX_SEARCHES = 12;

function recordCompetitorsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const room = await getDataRoom(ctx.orgId, args.project_id);
      if (!room) {
        return `No project #${args.project_id} in this workspace.`;
      }
      const ids = [...new Set(args.serp_result_ids)];
      const serps: SerpResult[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const serp = await recall(ctx, id);
        if (serp) {
          serps.push(serp);
        } else {
          missing.push(id);
        }
      }
      if (serps.length < 2) {
        return `Not recorded: ${serps.length} of ${ids.length} results pages were found${missing.length ? ` (not found: ${missing.join(', ')})` : ''}. A competitor is a domain that ranks for two or more searches, so run serp_search for at least five of the client's core services (with the city where the business is local) and pass every serpResultId.`;
      }
      const ownDomains = [...(room.meta.domains ?? []), ...(args.own_domains ?? [])];
      const competitors = competitorsFromSerps(serps, { ownDomains, exclude: args.exclude });
      const readAt = serps.map(s => s.retrievedAt).sort().at(-1)!;
      const isGoogleRanking = serps.every(s => s.isGoogleRanking);
      const locations = [...new Set(serps.map(s => s.location).filter((l): l is string => Boolean(l)))];
      await updateDataRoom(ctx.orgId, room.id, {
        competitors: {
          readAt,
          queries: serps.map(s => s.query),
          ...(locations.length ? { location: locations.join('; ') } : {}),
          isGoogleRanking,
          domains: competitors,
        },
      });
      return JSON.stringify({
        project: { id: room.id, title: room.title, href: projectHref(room.id) },
        searches: serps.map(s => ({ query: s.query, location: s.location ?? null, readAt: s.retrievedAt })),
        ...(missing.length ? { notFound: missing } : {}),
        ...(isGoogleRanking ? {} : { note: 'Some results came from web search, not Google\'s ranking: say so wherever these competitors are quoted.' }),
        competitors: competitors.map(c => ({ domain: c.domain, searches: c.ranked.length, ranked: c.ranked })),
        recorded: competitors.length
          ? `Recorded ${competitors.length} competitors on project #${room.id}; read_project lists them with the searches each ranked for. Cite those, never a competitor you only believe ranks.`
          : `No domain ranked for two or more of these ${serps.length} searches once directories and the client's own domains were left out. Recorded that on project #${room.id}; say so rather than naming competitors.`,
      });
    },
    {
      name: RECORD_COMPETITORS,
      description: 'Record a client\'s competitors on their project from Google results already read: pass the serpResultId of every serp_search you ran for the client\'s core services (5–10 searches, with the city where the business is local). Code counts them: a domain ranking for two or more searches is a competitor; directories, marketplaces, social networks and the client\'s own domains are left out. Each competitor is recorded with the searches it ranked for, its position and its page, dated. Never name a competitor this did not find.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project.'),
        serp_result_ids: z.array(z.string().max(40)).min(2).max(MAX_SEARCHES).describe('The serpResultId of each serp_search, one per core service search.'),
        own_domains: z.array(z.string().max(200)).max(10).optional().describe('The client\'s own domains beyond the project\'s, left out.'),
        exclude: z.array(z.string().max(200)).max(30).optional().describe('More domains that are listings rather than businesses for this client (a trade directory).'),
      }),
    },
  );
}

/**
 * The tool, for an agent granted the `serp` group or the tool by name.
 * @param ctx - The turn.
 */
export function competitorTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const grants = ctx.harnessConfig.grantTools ?? [];
  return grants.includes(SERP_GRANT) || grants.includes(RECORD_COMPETITORS) ? [recordCompetitorsTool(ctx)] : [];
}
