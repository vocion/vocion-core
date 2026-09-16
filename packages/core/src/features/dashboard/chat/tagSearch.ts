'use client';

import type { ChatComposerProps } from './ChatComposer';
import type { AgentOption, ContextRef } from './types';
import type { PageContext } from '@/services/chat/pageContext';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef } from 'react';
import { client } from '@/libs/Orpc';
import { contextTagRefs, matchesTag } from './composerTags';

/**
 * Everything the composer can pull into a turn, for one surface.
 *
 * Resolves an `@query` to taggable things — the artifact contract and the
 * page/record in view (`composerTags.ts`, pure), plus agents (from the
 * surface's own list), teams and missions (fetched once, then filtered
 * client-side; both lists are small and change rarely). The shape of a hit is
 * a `ContextRef`, the same one R4's page-context model reads, so a tag and
 * "the page I am on" reach the agent identically.
 *
 * It returns both halves the composer needs — the async reader behind `@`, and
 * the fixed list behind `(+)` — so the two paths can never offer different
 * things. Wired identically on all three surfaces the way `composerQueue.ts`
 * wires the send queue.
 * @param agents - The agents this surface can talk to.
 * @param pageContext - Where the person is standing, when the surface has one.
 */
export function useComposerTags(
  agents: AgentOption[],
  pageContext?: PageContext | null,
): Pick<ChatComposerProps, 'tagSearch' | 'attachable'> {
  const t = useTranslations('Chat');
  const cacheRef = useRef<{ teams: ContextRef[] | null; missions: ContextRef[] | null }>({ teams: null, missions: null });

  const attachable = useMemo(
    () => contextTagRefs(pageContext, { artifact: t('tag_artifact'), page: t('tag_page') }),
    [pageContext, t],
  );

  const tagSearch = useCallback(async (q: string) => {
    const term = q.trim().toLowerCase();
    const cache = cacheRef.current;
    if (cache.teams === null) {
      try {
        const res = await client.teams.list() as unknown as { teams: Array<{ slug: string; name: string; leadAgentSlug: string | null }> };
        // A `@team` tag routes the turn to the team's lead (§9).
        cache.teams = (res.teams ?? []).map(r => ({ type: 'team' as const, id: r.slug, label: r.name, ...(r.leadAgentSlug ? { routeTo: r.leadAgentSlug } : {}) }));
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
      // First, because it is the one tag that changes what the turn produces.
      ...attachable,
      ...agents.filter(a => a.slug !== '__search__').map(a => ({ type: 'agent' as const, id: a.slug, label: a.name })),
      ...cache.teams,
      ...cache.missions,
    ];
    return pool.filter(r => matchesTag(r, term)).slice(0, 12);
  }, [agents, attachable]);

  return { tagSearch, attachable };
}
