'use client';

import type { TeamMember } from './emptyChat';
import { useTranslations } from 'next-intl';
import { AgentDot } from '@/components/ui/agent-dot';
import { AgentStackItem, AgentStackMore } from '@/components/ui/agent-stack';
import { SparkOrb } from '@/components/ui/spark-orb';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { TEAM_SHOWN } from './emptyChat';

/** The stack's entrance; a hovered item's span rises above its neighbours. */
const ENTER = 'relative rounded-full hover:!z-30 focus-within:!z-30 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in';

/**
 * An agent's profile, from its slug.
 * @param slug - The agent's slug.
 */
function agentHref(slug: string) {
  return `/dashboard/agents/${encodeURIComponent(slug)}`;
}

/**
 * YOUR TEAM IS HERE: the centre of an empty conversation is the workspace's
 * agents, not a logo (founder, 2026-10-09: the calm start "looks too much
 * like Claude"). A small overlapping cluster: the lead in front as the
 * spark at rest, its teammates as smaller `AgentDot`s; at most four, then
 * "+N". Each comes forward on hover with its name and opens its profile; the
 * "+N" opens the team. Under it, a quiet caption ("Ava · Revenue lead · 3 agents")
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
  const leadLabel = lead.leadLabel ?? lead.name;
  const caption = members.length === 1 ? leadLabel : t('team_caption', { lead: leadLabel, count: members.length });
  return (
    <div data-testid="team-cluster" className="flex flex-col items-center [@media(max-height:480px)]:hidden">
      {/* Every agent here comes forward on hover, says who it is and opens
          its profile; the "+N" opens the whole team (`AgentStackItem`). The
          entrance animation sits on an outer span and the hover on the item,
          so a held animation transform never pins the item in place. */}
      <div className="group/stack flex items-center">
        {/* The lead in front: drawn last among siblings would hide it, so it
            sits first with the highest z. It is the spark at rest
            (`SparkOrb`), the mark of the agent who answers, still until a
            turn runs; colour now means "at work" (2026-10-23). */}
        <span className={cn(ENTER, 'z-10 motion-safe:zoom-in-90')} data-testid="team-lead">
          <AgentStackItem label={leadLabel} href={agentHref(lead.slug)} className="ring-4">
            <SparkOrb size="xl" working={false} className="size-14" />
          </AgentStackItem>
        </span>
        {rest.map((m, i) => (
          <span
            key={m.slug}
            className={cn(ENTER, i === 0 ? 'ml-1' : '-ml-2', 'motion-safe:fill-mode-both motion-safe:slide-in-from-left-2')}
            style={{ zIndex: 9 - i, animationDelay: `${80 + i * 60}ms` }}
            data-testid="team-member"
          >
            <AgentStackItem label={m.name} href={agentHref(m.slug)}>
              <AgentDot name={m.name} accent={m.accent} size="md" decorative className="size-7 text-[10px]" />
            </AgentStackItem>
          </span>
        ))}
        {more > 0 && (
          <span className={cn(ENTER, '-ml-2')}>
            <AgentStackMore count={more} href={href} label={t('team_more_label', { count: members.length })} className="size-7 text-[11px]" testId="team-more" />
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
