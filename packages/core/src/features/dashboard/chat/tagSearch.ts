'use client';

import type { AgentOption, ContextRef } from './types';
import { useCallback, useRef } from 'react';
import { client } from '@/libs/Orpc';

/**
 * Resolve an `@query` in the composer to taggable records — agents (from the
 * surface's own list), teams and missions (fetched once, then filtered
 * client-side; both lists are small and change rarely). The shape of a hit
 * is a `ContextRef`, the same one R4's page-context model reads, so a tag
 * and "the page I am on" reach the agent identically.
 * @param agents - The agents this surface can talk to.
 */
export function useTagSearch(agents: AgentOption[]): (q: string) => Promise<ContextRef[]> {
  const cacheRef = useRef<{ teams: ContextRef[] | null; missions: ContextRef[] | null }>({ teams: null, missions: null });

  return useCallback(async (q: string) => {
    const term = q.trim().toLowerCase();
    const cache = cacheRef.current;
    if (cache.teams === null) {
      try {
        const res = await client.teams.list() as unknown as { teams: Array<{ slug: string; name: string }> };
        cache.teams = (res.teams ?? []).map(r => ({ type: 'team' as const, id: r.slug, label: r.name }));
      } catch {
        cache.teams = [];
      }
    }
    if (cache.missions === null) {
      try {
        const rows = await client.missions.list() as unknown as Array<{ slug: string; name: string }>;
        cache.missions = rows.map(r => ({ type: 'mission' as const, id: r.slug, label: r.name }));
      } catch {
        cache.missions = [];
      }
    }
    const pool: ContextRef[] = [
      ...agents.filter(a => a.slug !== '__search__').map(a => ({ type: 'agent' as const, id: a.slug, label: a.name })),
      ...cache.teams,
      ...cache.missions,
    ];
    const hits = term
      ? pool.filter(r => r.label.toLowerCase().includes(term) || r.id.toLowerCase().includes(term))
      : pool;
    return hits.slice(0, 12);
  }, [agents]);
}
