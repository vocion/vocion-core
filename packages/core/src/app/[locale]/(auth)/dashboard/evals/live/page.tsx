import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AgentScoreboardView } from '@/features/dashboard/agentScoreboard/AgentScoreboardView';
import { onlineLine, readScoreboardQuery } from '@/features/dashboard/agentScoreboard/scoreboard';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { listFlaggedTurns, loadAgentScoreboard } from '@/services/evals/live/signals';
import { describeOnlineEvaluation } from '@/services/evals/online';

export const metadata: Metadata = { title: 'Live agents' };

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Live agents (ADR 0010): every agent at every level on the signals read off
 * its live turns, then the flagged turns behind them. The offline
 * `agent-behaviour` eval scores the same dimensions against made-up data.
 * @param props - Route props.
 * @param props.params - The locale segment.
 * @param props.searchParams - `days` and `agent`.
 */
export default async function LiveAgentsPage(props: Props) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const query = readScoreboardQuery(await props.searchParams);
  const [board, timezone, online] = await Promise.all([
    loadAgentScoreboard(orgId, { days: query.days }),
    workspaceTimeZone(orgId),
    describeOnlineEvaluation(orgId).catch(() => null),
  ]);
  const turns = await listFlaggedTurns(orgId, { since: board.since, agentSlug: query.agent, limit: 100 });
  return (
    <>
      <TitleBar title="Live agents" description="How each agent is doing on real turns: refusals with an action there, saves it claimed but never made, and turns where tools kept failing." />
      <AgentScoreboardView query={query} scores={board.scores} turns={turns} since={board.since} timezone={timezone} online={onlineLine(online)} />
    </>
  );
}
