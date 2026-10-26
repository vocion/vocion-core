import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { connectChannelAction } from '@/features/dashboard/connect-channel/actions';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectableWorkspaces } from '@/services/chat/connectChannel';

export const metadata: Metadata = { title: 'Connect a channel' };

/** What each refusal says, in the words a person can act on. */
const REASONS: Record<string, string> = {
  not_admin: 'Only an admin of your Vocion Org can connect a channel. Ask one to open this link.',
  bad_request: 'This link is missing the channel. Mention Vocion in the channel again for a fresh one.',
  not_your_workspace: 'That workspace is not in your Org.',
  other_team: 'This channel is in a Slack workspace this Vocion installation does not serve. Add the Slack app of the Vocion installation that workspace belongs to.',
  already_connected: 'This channel is already connected to a workspace.',
  no_agent: 'That workspace has no active agent to answer in the channel yet.',
};

/**
 * Connect a chat channel to a workspace: where the "Connect this channel"
 * button an unbound channel posts leads (`ChatSurfaceService.promptUnbound`).
 * An admin picks one of their Org's workspaces and the channel answers as its
 * lead from the next mention.
 * @param props - Route props.
 * @param props.params - Locale.
 * @param props.searchParams - surface, team, channel, and the outcome of a submit.
 */
export default async function ConnectChannelPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const query = await props.searchParams;
  const surface = query.surface ?? 'slack';
  const channel = query.channel ?? '';
  const team = query.team ?? '';
  const { accountId, role } = await auth();
  const workspaces = accountId ? await connectableWorkspaces(accountId) : [];
  const done = query.done ? workspaces.find(w => w.id === query.done) : undefined;
  const surfaceName = surface === 'slack' ? 'Slack' : surface;

  return (
    <main className="mx-auto grid max-w-lg gap-5 px-4 py-10">
      <h1 className="text-2xl font-semibold text-balance">{`Connect a ${surfaceName} channel`}</h1>
      {done
        ? <p role="status">{`Connected. The channel now answers as ${done.name}. Mention Vocion there to start.`}</p>
        : (
            <>
              <p className="text-muted-foreground">{`Pick the workspace that should answer in this ${surfaceName} channel. Mentions there will go to its lead.`}</p>
              {query.error && <p role="alert" className="text-destructive">{REASONS[query.error] ?? 'That did not work. Try the link again.'}</p>}
              {role !== 'admin'
                ? <p>{REASONS.not_admin}</p>
                : !channel
                    ? <p>{REASONS.bad_request}</p>
                    : (
                        <form action={connectChannelAction} className="grid gap-4">
                          <input type="hidden" name="surface" value={surface} />
                          <input type="hidden" name="channel" value={channel} />
                          {team && <input type="hidden" name="team" value={team} />}
                          <label className="grid gap-1.5 text-sm font-medium" htmlFor="connect-channel-workspace">
                            Workspace
                            <select id="connect-channel-workspace" name="workspace" required className="h-11 rounded-md border border-input bg-background px-3 text-base">
                              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                          </label>
                          <Button type="submit" className="h-11">Connect this channel</Button>
                        </form>
                      )}
            </>
          )}
    </main>
  );
}
