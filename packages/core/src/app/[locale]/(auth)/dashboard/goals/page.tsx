import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { GoalsList } from '@/features/goals/GoalsList';
import { clerkAuth as auth } from '@/libs/Auth';
import { goalsListFor } from '@/services/objectives/goalPages';

export const metadata: Metadata = { title: 'Goals' };

/**
 * Goals — a workspace's goals, everyone's, with the person's own first in
 * reach (the Mine chip); in Personal, "Your goals": every goal the person
 * owns across the workspaces their Personal reaches, each labelled with its
 * workspace and Org (#1316). A goal is set from a conversation, as a Decision
 * the assistant drafts — never from a form here.
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function GoalsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const list = orgId && userId ? await goalsListFor({ orgId, userId }) : { personal: false, rows: [], withheld: [] };
  return (
    <ListPage
      title={list.personal ? 'Your goals' : 'Goals'}
      description={list.personal ? 'Every goal you own, across your workspaces, and where each one stands.' : 'Outcomes people here own, each with a horizon and a measure that counts itself.'}
    >
      <GoalsList rows={list.rows} across={list.personal} withheld={list.withheld} emptyHint="Say “make this a goal” in any chat, or tell the assistant what you want done by when. It drafts the goal for you to approve." />
    </ListPage>
  );
}
