'use client';

import type { GoalDetail } from './types';
import type { GoalStatus } from '@/libs/objectives/goal';
import { ArrowRight, Check, Link2, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DetailMeta, DetailPage, MetaChip, Section, StatusDot } from '@/components/patterns';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { PROMPT_PILL_CLASS } from '@/features/dashboard/chat/SuggestionPills';
import { useRecordContext } from '@/features/dashboard/context/useRecordContext';
import { Link } from '@/libs/I18nNavigation';
import { goalPinTarget } from '@/libs/objectives/goal';
import { client } from '@/libs/Orpc';
import { recordRef } from '@/services/chat/recordContext';
import { GoalProgressBar } from './GoalProgressBar';

const LINK_NOUN: Record<string, string> = { room: 'Data room', wiki: 'Wiki', artifact: 'Artifact', view: 'View', conversation: 'Chat', record: 'Record' };

/**
 * ONE GOAL — a calm page: the title and horizon, where it stands (a bar and
 * its words), its milestones, what it links to, a short line of what moved,
 * and "Next step": up to three prompts the assistant proposes, each a pill
 * that starts a turn (#1296), never a card. Pause, Done and Drop are the
 * owner's, and so is ticking a milestone by hand, which then holds against
 * every check.
 *
 * The page declares the goal as its record, so the rail's chat is about it
 * and a turn there reads it (`goal_progress`). Pinnable: the page carries its
 * pin target (`goalPinTarget`) for the object pins on `feat/pin-favorites`;
 * the header's pin control mounts here when that lands.
 * @param props - The page.
 * @param props.goal - The goal, read on the server.
 * @param props.listHref - Back to the list it came from.
 */
export function GoalView({ goal, listHref }: { goal: GoalDetail; listHref: string }) {
  useRecordContext(recordRef('goal', goal.id, goal.title));
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const pin = goalPinTarget(goal.id);

  const act = (write: () => Promise<unknown>) => start(async () => {
    setProblem(null);
    try {
      await write();
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That did not go through. Try again.');
    }
  });
  const setStatus = (status: GoalStatus) => act(() => client.goals.setStatus({ goalId: goal.id, status }));
  const ask = (prompt: string) => openAgentSurface(
    { prompt, send: true, context: { path: pathname, title: goal.title, record: recordRef('goal', goal.id, goal.title), openedFrom: true } },
    href => router.push(href),
  );

  const closed = goal.status === 'done' || goal.status === 'dropped';
  const statusDot = goal.status === 'active'
    ? <StatusDot tone={goal.stalledDays ? 'amber' : 'pass'} label={goal.stalledDays ? `Quiet for ${goal.stalledDays} days` : 'Active'} />
    : <StatusDot tone="neutral" label={{ paused: 'Paused', done: 'Done', dropped: 'Dropped', active: 'Active' }[goal.status]} />;

  return (
    <DetailPage
      data-testid="goal-page"
      crumbs={[{ label: 'Goals', href: listHref }, { label: `GOAL-${goal.id}` }]}
      title={goal.title}
      subtitle={`${goal.horizon}${goal.status === 'active' && goal.daysLeft >= 0 ? ` · ${goal.daysLeft} ${goal.daysLeft === 1 ? 'day' : 'days'} left` : ''}`}
      meta={<DetailMeta items={[statusDot, <MetaChip key="owner">{goal.owner}</MetaChip>, <MetaChip key="ws">{goal.workspace}</MetaChip>, goal.weeklyReview && <MetaChip key="review">Weekly review</MetaChip>]} />}
      actions={goal.isOwner && (
        <span className="flex flex-wrap items-center gap-1.5" data-pin-kind={pin.kind} data-pin-id={pin.id}>
          {goal.status === 'active' && <GoalButton onClick={() => setStatus('paused')} disabled={pending} testId="goal-pause">Pause</GoalButton>}
          {(goal.status === 'paused' || closed) && <GoalButton onClick={() => setStatus('active')} disabled={pending} testId="goal-resume">{closed ? 'Reopen' : 'Resume'}</GoalButton>}
          {!closed && <GoalButton onClick={() => setStatus('done')} disabled={pending} testId="goal-done">Done</GoalButton>}
          {!closed && <GoalButton onClick={() => setStatus('dropped')} disabled={pending} testId="goal-drop" quiet>Drop</GoalButton>}
        </span>
      )}
    >
      {problem && <p role="alert" className="pt-4 text-sm text-destructive">{problem}</p>}

      <Section eyebrow="Progress" data-testid="goal-progress-section">
        <GoalProgressBar ratio={goal.progress.ratio} label={goal.progress.label} size="page" />
        <p className="mt-2 text-[13px] text-muted-foreground">
          {goal.measure.kind === 'view'
            ? (
                <>
                  Counted from the view
                  {' '}
                  {goal.measure.href ? <Link href={goal.measure.href} className="underline underline-offset-2">{goal.measure.viewName}</Link> : <span>{goal.measure.viewName}</span>}
                  , never ticked by hand.
                </>
              )
            : 'Milestones are done when their linked work is, or when you say so.'}
          {goal.progress.unmeasured ? ` ${goal.progress.unmeasured}` : ''}
        </p>
      </Section>

      {!closed && goal.nextSteps.length > 0 && (
        <Section eyebrow="Next step" data-testid="goal-next-steps">
          <div role="group" aria-label="Next steps" className="flex flex-wrap gap-1.5">
            {goal.nextSteps.map(s => (
              <button key={s.prompt} type="button" onClick={() => ask(s.prompt)} className={PROMPT_PILL_CLASS} title={s.why} data-testid="goal-next-step">
                <span className="min-w-0 break-words">{s.label}</span>
                <ArrowRight className="size-3.5 shrink-0" aria-hidden />
              </button>
            ))}
          </div>
        </Section>
      )}

      {goal.milestones.length > 0 && (
        <Section eyebrow="Milestones" data-testid="goal-milestones">
          <ol className="flex flex-col">
            {goal.milestones.map(m => (
              <li key={m.key} className="flex items-start gap-3 py-1.5" data-testid="goal-milestone" data-done={m.done || undefined}>
                <button
                  type="button"
                  disabled={!goal.isOwner || pending}
                  onClick={() => act(() => client.goals.setMilestone({ goalId: goal.id, key: m.key, done: !m.done }))}
                  aria-pressed={m.done}
                  aria-label={`${m.done ? 'Reopen' : 'Mark done'}: ${m.label}`}
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full transition-colors max-md:size-7 ${m.done ? 'bg-[var(--brand-pass)]/15 text-[var(--brand-pass)]' : 'border border-border hover:border-foreground/50'} disabled:cursor-default`}
                >
                  {m.done && <Check className="size-3.5" aria-hidden />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className={m.done ? 'text-muted-foreground' : 'text-foreground'}>{m.label}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {[
                      m.link ? <Link key="l" href={m.link.href} className="underline underline-offset-2">{m.link.title}</Link> : null,
                      m.done && m.by ? (m.by === 'agent' ? `done by the assistant${m.evidence ? ` — ${m.evidence}` : ''}` : 'done by you') : null,
                      !m.done && m.locked ? 'reopened by you' : null,
                    ].filter(Boolean).map((part, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {part}
                      </span>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section eyebrow="Linked" data-testid="goal-links">
        {goal.links.length === 0
          ? <p className="text-[13px] text-muted-foreground">Nothing linked yet. Ask the assistant to link a data room, a wiki page, an artifact, a view or a conversation.</p>
          : (
              <ul className="flex flex-col">
                {goal.links.map(l => (
                  <li key={`${l.kind}:${l.id}`} className="group flex items-center gap-2 py-1">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Link href={l.href} className="min-w-0 truncate hover:underline">{l.title}</Link>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{LINK_NOUN[l.kind] ?? l.kind}</span>
                    {goal.isOwner && (
                      <button type="button" onClick={() => act(() => client.goals.unlink({ goalId: goal.id, kind: l.kind as never, id: l.id }))} aria-label={`Unlink ${l.title}`} className="ml-auto grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {goal.activity.length > 0 && (
        <Section eyebrow="What moved" tone="quiet" data-testid="goal-activity">
          <ul className="flex flex-col gap-0.5 text-[13px] text-muted-foreground">
            {goal.activity.slice(0, 6).map(a => (
              <li key={`${a.at}|${a.what}`}>
                <time dateTime={a.at} className="tabular-nums">{new Date(a.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>
                {' · '}
                {a.what}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </DetailPage>
  );
}

function GoalButton(props: { onClick: () => void; disabled?: boolean; quiet?: boolean; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
      className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors max-md:min-h-11 ${props.quiet ? 'text-muted-foreground hover:text-foreground' : 'border border-border text-foreground hover:bg-surface-hover'} disabled:opacity-60`}
    >
      {props.children}
    </button>
  );
}
