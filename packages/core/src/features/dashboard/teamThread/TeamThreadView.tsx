import type { DotTone } from '@/components/patterns';
import type { TeamThreadView as Thread, ThreadPostView } from '@/libs/teams/thread';
import { FactList, Section, StatusDot } from '@/components/patterns';
import { dollars } from '@/libs/teams/thread';

/**
 * A TEAM THREAD, read as the one run it is: the outcome first — what the lead
 * concluded and which rule settled it — then whose thread it is and what it
 * cost against its caps, then every post, round by round, the evidence under
 * the outcome (principle 10). The run page around it keeps the run's own
 * actions; nothing here is a second history of the thread.
 * @param props - The component's props.
 * @param props.thread - The thread (`threadViewOf`).
 */
export function TeamThreadView({ thread }: { thread: Thread }) {
  const running = thread.status === 'running';
  const rounds = groupByRound(thread.posts.filter(p => p.kind !== 'outcome'));
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col" data-testid="team-thread">
      <Section eyebrow="Outcome" commentField={null} data-testid="team-thread-outcome">
        {thread.outcome
          ? <p className="break-words whitespace-pre-wrap">{thread.outcome}</p>
          : <p className="text-muted-foreground">{emptyOutcome(thread.status)}</p>}
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="team-thread-settled">
          {thread.settled ?? `Open — round ${thread.round} of ${thread.maxRounds}. It settles when ${thread.lead.name} declares it done, every member marks their part complete, or it reaches its round or budget cap.`}
        </p>
      </Section>

      <Section eyebrow="Thread" commentField={null}>
        <FactList
          facts={[
            { key: 'question', label: 'Question', value: <span className="break-words whitespace-pre-wrap">{thread.question}</span> },
            {
              key: 'owner',
              label: 'Owner',
              value: (
                <span>
                  {thread.lead.name}
                  <span className="text-muted-foreground"> · lead</span>
                  {thread.accountable && (
                    <>
                      {', '}
                      {thread.accountable.name}
                      <span className="text-muted-foreground"> · accountable</span>
                    </>
                  )}
                </span>
              ),
            },
            {
              key: 'members',
              label: 'Members',
              value: (
                <ul className="flex flex-col gap-1" data-testid="team-thread-members">
                  {thread.members.map(m => (
                    <li key={m.slug} data-complete={m.complete ? 'true' : 'false'}>
                      <StatusDot
                        tone={m.complete ? 'pass' : 'neutral'}
                        label={(
                          <span>
                            {m.name}
                            {m.complete && <span className="text-muted-foreground"> · marked complete</span>}
                          </span>
                        )}
                      />
                    </li>
                  ))}
                </ul>
              ),
            },
            {
              key: 'rounds',
              label: 'Rounds',
              value: <span className="tabular-nums">{`${thread.round} of ${thread.maxRounds} · ${thread.turnOrder === 'parallel' ? 'everyone posts at once' : 'one after another'}`}</span>,
            },
            {
              key: 'cost',
              label: 'Cost',
              value: (
                <span className="tabular-nums" data-testid="team-thread-cost">
                  {thread.spentCents === null ? 'Not recorded' : dollars(thread.spentCents)}
                  <span className="text-muted-foreground">{` of a ${dollars(thread.capCents)} cap`}</span>
                </span>
              ),
            },
          ]}
        />
      </Section>

      <Section eyebrow="Posts" commentField={null} action={<span className="text-muted-foreground tabular-nums">{thread.posts.filter(p => p.kind !== 'outcome').length}</span>}>
        {rounds.length === 0
          ? <p className="text-muted-foreground">{running ? 'Waiting for the first post.' : 'Nobody posted.'}</p>
          : (
              <ol className="flex flex-col gap-6" data-testid="team-thread-posts">
                {rounds.map(([round, posts]) => (
                  <li key={round}>
                    <h4 className="mb-2 text-[12px] font-medium text-muted-foreground">{`Round ${round}`}</h4>
                    <ul className="flex flex-col divide-y divide-rule">
                      {posts.map(p => <Post key={p.id} post={p} />)}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
      </Section>
    </div>
  );
}

function Post({ post }: { post: ThreadPostView }) {
  return (
    <li className="py-3 first:pt-0" data-testid="team-thread-post" data-kind={post.kind}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <StatusDot tone={postTone(post)} pulse={post.status === 'running'} label={<span className="font-medium">{post.agentName}</span>} />
        {post.kind === 'review' && <span className="text-[12px] text-muted-foreground">lead · steer for the next round</span>}
        {post.complete && <span className="text-[12px] text-muted-foreground">marked their part complete</span>}
      </div>
      {post.body && <p className="text-sm break-words whitespace-pre-wrap">{post.body}</p>}
      {post.status === 'running' && !post.body && <p className="text-sm text-muted-foreground">Writing…</p>}
      {post.error && <p className="text-sm break-words text-brand-fail">{`Failed — ${post.error.split('\n')[0]}`}</p>}
    </li>
  );
}

function postTone(post: ThreadPostView): DotTone {
  if (post.status === 'failed') {
    return 'fail';
  }
  if (post.status === 'running') {
    return 'amber';
  }
  return post.complete ? 'pass' : 'ink';
}

function emptyOutcome(status: string): string {
  if (status === 'running') {
    return 'The team is still discussing it. The lead writes the outcome when it settles.';
  }
  if (status === 'cancelled') {
    return 'Cancelled before an outcome was written.';
  }
  return 'The thread ended without an outcome.';
}

function groupByRound(posts: readonly ThreadPostView[]): Array<[number, ThreadPostView[]]> {
  const byRound = new Map<number, ThreadPostView[]>();
  for (const p of posts) {
    const round = p.round ?? 0;
    byRound.set(round, [...(byRound.get(round) ?? []), p]);
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
}
