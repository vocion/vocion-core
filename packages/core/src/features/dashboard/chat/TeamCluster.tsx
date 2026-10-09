'use client';

import type { TeamMember } from './emptyChat';
import { useTranslations } from 'next-intl';
import { AgentDot } from '@/components/ui/agent-dot';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { TEAM_SHOWN } from './emptyChat';

/**
 * YOUR TEAM IS HERE: the centre of an empty conversation is the workspace's
 * agents, not a logo (founder, 2026-10-09: the calm start "looks too much
 * like Claude"). A small overlapping cluster of their `AgentDot`s, the lead
 * in front and a size larger, wearing the Org's accent as its ring; at most
 * four, then "+N". Under it, a quiet caption ("Workspace lead · 3 agents")
 * that opens the team. Only the lead when it is alone; a personal workspace's
 * assistant the same way. The dots settle in once, and not at all with
 * reduced motion; nothing loops.
 * @param props - The cluster's inputs.
 * @param props.members - The team, lead first.
 * @param props.href - Where the caption goes. Default: the team.
 */
export function TeamCluster({ members, href = '/dashboard/teams' }: { members: readonly TeamMember[]; href?: string }) {
  const t = useTranslations('Chat');
  const lead = members[0];
  if (!lead) {
    return null;
  }
  const rest = members.slice(1, TEAM_SHOWN);
  const more = members.length - 1 - rest.length;
  const caption = members.length === 1 ? lead.name : t('team_caption', { lead: lead.name, count: members.length });
  return (
    <div data-testid="team-cluster" className="flex flex-col items-center [@media(max-height:480px)]:hidden">
      <div className="flex items-center" aria-hidden>
        {/* The lead in front: drawn last among siblings would hide it, so it sits first with the highest z. */}
        <span className="relative z-10 rounded-full ring-2 ring-[var(--org-accent,var(--brand-amber))] ring-offset-2 ring-offset-background motion-safe:animate-in motion-safe:duration-300 motion-safe:zoom-in-90 motion-safe:fade-in" data-testid="team-lead">
          <AgentDot name={lead.name} accent={lead.accent} size="xl" decorative className="size-12 text-lg" />
        </span>
        {rest.map((m, i) => (
          <span
            key={m.slug}
            className={cn(i === 0 ? '-ml-1' : '-ml-2.5', 'rounded-full ring-2 ring-background motion-safe:animate-in motion-safe:duration-300 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-left-2')}
            style={{ zIndex: 9 - i, animationDelay: `${80 + i * 60}ms` }}
            data-testid="team-member"
          >
            <AgentDot name={m.name} accent={m.accent} size="lg" decorative className="size-9" />
          </span>
        ))}
        {more > 0 && (
          <span className="-ml-2.5 grid size-9 place-items-center rounded-full bg-surface-soft text-[12px] font-medium text-muted-foreground ring-2 ring-background" data-testid="team-more">
            {`+${more}`}
          </span>
        )}
      </div>
      <Link
        href={href}
        data-testid="team-caption"
        className={cn('mt-3 rounded-md px-1.5 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none')}
      >
        {caption}
      </Link>
    </div>
  );
}
