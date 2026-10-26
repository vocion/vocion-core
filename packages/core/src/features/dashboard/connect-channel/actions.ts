'use server';

import { redirect } from 'next/navigation';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectChannel } from '@/services/chat/connectChannel';

/**
 * The connect-channel form's submit: bind the channel to the chosen workspace,
 * then show the page again with the outcome.
 * @param form - surface, team, channel and the chosen workspace.
 */
export async function connectChannelAction(form: FormData): Promise<void> {
  const { userId, accountId, role } = await auth();
  const surface = String(form.get('surface') ?? '');
  const team = String(form.get('team') ?? '') || null;
  const channel = String(form.get('channel') ?? '');
  const projectId = String(form.get('workspace') ?? '');
  const result = await connectChannel({ userId, accountId, role }, { surface, teamId: team, channelId: channel, projectId });
  const query = new URLSearchParams({ surface, channel, ...(team ? { team } : {}), ...(result.ok ? { done: projectId } : { error: result.reason }) });
  redirect(`/dashboard/connect-channel?${query.toString()}`);
}
