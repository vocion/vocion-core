import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { GoalView } from '@/features/goals/GoalView';
import { clerkAuth as auth } from '@/libs/Auth';
import { goalDetailFor } from '@/services/objectives/goalPages';

export const metadata: Metadata = { title: 'Goal' };

/**
 * One goal, measured as the page opens (`services/objectives/goalPages.ts`).
 * Read in the workspace the person is in: a goal that lives elsewhere is not
 * found here, and the Personal list links each goal to its own workspace.
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function GoalPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const goalId = Number.parseInt(id, 10);
  if (!orgId || !userId || !Number.isSafeInteger(goalId) || goalId <= 0) {
    notFound();
  }
  const goal = await goalDetailFor({ orgId, userId, goalId });
  if (!goal) {
    notFound();
  }
  return <GoalView goal={goal} listHref="/dashboard/goals" />;
}
