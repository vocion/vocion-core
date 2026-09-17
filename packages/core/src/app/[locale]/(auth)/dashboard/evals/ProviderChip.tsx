'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { describeProvider } from '@/features/evals/providerCopy';

/**
 * The grader behind a score, named and explained.
 *
 * A client component because the tooltip is one, and it appears on both the
 * dataset list and the dataset itself so the label means the same thing in
 * both places. The explanation is in a tooltip rather than on the page because
 * someone who already knows the difference should not have to read it again on
 * every card.
 * @param props - Props.
 * @param props.providerId - The id stored on the run, e.g. `agentcore`.
 * @param props.className - Extra classes for the badge.
 */
export function ProviderChip(props: { providerId: string; className?: string }) {
  const { label, explanation } = describeProvider(props.providerId);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={props.className} tabIndex={0}>
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{explanation}</TooltipContent>
    </Tooltip>
  );
}
