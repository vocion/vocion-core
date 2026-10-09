import type { OrgBrandView } from '@/libs/branding/orgBrand';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { cn } from '@/utils/Helpers';

/**
 * An Org's logo, as wide as it is: the wordmark (its dark version on dark
 * pages), else the mark beside the name in text, else the name alone. Never
 * the Vocion mark in an Org's place — that is `PoweredByVocion`'s, small,
 * underneath.
 * @param props - The brand and the size.
 * @param props.brand - The Org's brand view.
 * @param props.size - `sm` for the sidebar, `lg` for sign-in.
 * @param props.className - Extra classes on the wrapper.
 */
export function OrgLogo({ brand, size = 'sm', className }: { brand: Pick<OrgBrandView, 'name' | 'logo' | 'mark'>; size?: 'sm' | 'lg'; className?: string }) {
  const h = size === 'lg' ? 'h-9 max-w-[220px]' : 'h-6 max-w-[168px]';
  if (brand.logo.light) {
    const dark = brand.logo.dark && brand.logo.dark !== brand.logo.light ? brand.logo.dark : null;
    return (
      <span className={cn('inline-flex min-w-0 items-center', className)} data-testid="org-logo">
        {/* eslint-disable-next-line next/no-img-element */}
        <img src={brand.logo.light} alt={brand.name} className={cn('w-auto object-contain', h, dark && 'dark:hidden')} />
        {dark && (
          // eslint-disable-next-line next/no-img-element
          <img src={dark} alt={brand.name} className={cn('hidden w-auto object-contain dark:block', h)} />
        )}
      </span>
    );
  }
  const markH = size === 'lg' ? 'h-9' : 'h-6';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} data-testid="org-logo">
      {brand.mark.light && (
        <>
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={brand.mark.light} alt="" aria-hidden className={cn('w-auto shrink-0 object-contain', markH, brand.mark.dark && brand.mark.dark !== brand.mark.light && 'dark:hidden')} />
          {brand.mark.dark && brand.mark.dark !== brand.mark.light && (
            // eslint-disable-next-line next/no-img-element
            <img src={brand.mark.dark} alt="" aria-hidden className={cn('hidden w-auto shrink-0 object-contain dark:block', markH)} />
          )}
        </>
      )}
      <span className={cn('truncate font-semibold tracking-tight text-foreground', size === 'lg' ? 'text-2xl' : 'text-[15px]')}>{brand.name}</span>
    </span>
  );
}

/**
 * The Org's square mark for a small slot (the rail): its mark, else Vocion's
 * — the rail never goes blank.
 * @param props - The brand and classes.
 * @param props.brand - The Org's brand view, or null.
 * @param props.className - Size classes.
 */
export function OrgMark({ brand, className }: { brand: Pick<OrgBrandView, 'mark'> | null; className?: string }) {
  const light = brand?.mark.light ?? VOCION_PRIMARY_MARK;
  const dark = brand?.mark.dark && brand.mark.dark !== light ? brand.mark.dark : null;
  return (
    <>
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={light} alt="" aria-hidden data-testid="org-mark" className={cn('w-auto object-contain', className, dark && 'dark:hidden')} />
      {dark && (
        // eslint-disable-next-line next/no-img-element
        <img src={dark} alt="" aria-hidden className={cn('hidden w-auto object-contain dark:block', className)} />
      )}
    </>
  );
}

/**
 * "Powered by Vocion", small — kept under an Org's own logo on sign-in and in
 * the sidebar. Removing it is white-labelling, which is not core
 * (`branding.whiteLabel` in `libs/extensions.ts`); the view says when.
 * @param props - Classes.
 * @param props.className - Extra classes.
 */
export function PoweredByVocion({ className }: { className?: string }) {
  return (
    <span data-testid="powered-by-vocion" className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground', className)}>
      Powered by
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={VOCION_PRIMARY_MARK} alt="" aria-hidden className="h-3 w-auto" />
      <span className="text-foreground/80">Vocion</span>
    </span>
  );
}

/**
 * Vocion's own name, quietly — the drawer footer's line when Vocion leads the
 * install (Vocion Cloud), where an Org's logo sits in the switcher above it.
 * @param props - Classes.
 * @param props.className - Extra classes.
 */
export function VocionWordmark({ className }: { className?: string }) {
  return (
    <span data-testid="vocion-wordmark" className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-tight text-muted-foreground', className)}>
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={VOCION_PRIMARY_MARK} alt="" aria-hidden className="h-3 w-auto" />
      Vocion
    </span>
  );
}

/**
 * The install's lead brand as a small mark, ~20px — the top bar's leading
 * edge, next to the sidebar toggle (`libs/branding/chrome.ts`): the Org's
 * mark where the Org leads, Vocion's where Vocion does.
 * @param props - The brand, who leads, and classes.
 * @param props.brand - The Org's brand view, or null.
 * @param props.lead - Whose mark leads.
 * @param props.className - Extra classes.
 */
export function LeadMark({ brand, lead, className }: { brand: Pick<OrgBrandView, 'name' | 'mark' | 'logo'> | null; lead: 'vocion' | 'org'; className?: string }) {
  const own = lead === 'org' ? (brand?.mark.light ? brand.mark : brand?.logo.light ? brand.logo : null) : null;
  const light = own?.light ?? VOCION_PRIMARY_MARK;
  const dark = own?.dark && own.dark !== light ? own.dark : null;
  return (
    <span data-testid="lead-mark" data-lead={own ? 'org' : 'vocion'} className={cn('inline-flex h-5 shrink-0 items-center', className)}>
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={light} alt="" aria-hidden className={cn('h-5 max-w-16 w-auto object-contain', dark && 'dark:hidden')} draggable={false} />
      {dark && (
        // eslint-disable-next-line next/no-img-element
        <img src={dark} alt="" aria-hidden className="hidden h-5 w-auto max-w-16 object-contain dark:block" draggable={false} />
      )}
    </span>
  );
}
