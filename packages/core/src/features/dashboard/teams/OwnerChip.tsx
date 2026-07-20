import type { AccountableUser } from '@/services/TeamService';
import { House, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { initials, ownerDisplayName, ownerProvenance } from './helpers';

/**
 * The accountable-human chip on every team surface (acceptance #6):
 * avatar initials + name for an explicit owner; the mandated visible
 * text "«Name» (workspace default)" for an inherited one (mock
 * walkthrough: text first, glyph + tooltip secondary); a warning-tinted
 * "No owner" when neither the team nor the workspace names anyone —
 * never a blank.
 * @param root0
 * @param root0.accountable - The resolved owner from TeamService, or null.
 */
export function OwnerChip({ accountable }: { accountable: AccountableUser | null }) {
  const t = useTranslations('Teams');
  const provenance = ownerProvenance(accountable);

  if (provenance === 'missing' || accountable === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand-amber-deep)]">
        <TriangleAlert className="size-3.5" aria-hidden />
        {t('owner_missing')}
      </span>
    );
  }

  const name = ownerDisplayName(accountable);

  if (provenance === 'explicit') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
        <Avatar name={name} muted={false} />
        <span className="font-medium">{name}</span>
      </span>
    );
  }

  // Inherited from the workspace default. The text carries the meaning;
  // the tooltip only teaches how to override.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar name={name} muted />
          <span>{t('owner_inherited', { name })}</span>
          <House className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{t('owner_inherited_tooltip')}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Tiny initials avatar for the owner row.
 * @param root0
 * @param root0.name - Owner display name.
 * @param root0.muted - Muted (inherited) vs solid (explicit) treatment.
 */
function Avatar({ name, muted }: { name: string; muted: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-background ${
        muted ? 'bg-muted-foreground/50' : 'bg-[var(--brand-teal)]'
      }`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
