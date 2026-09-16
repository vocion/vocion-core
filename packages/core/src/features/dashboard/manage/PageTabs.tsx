import type { LucideIcon } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

export type PageTab = { url: string; label: string; icon?: LucideIcon };

/**
 * Link tabs for a page that is several sections in one (Teams & agents,
 * Skills & tools). Each tab is its own URL — deep-linkable, pinnable, and a
 * registered route — so this is a row of links with an underline, not
 * client-side tab state. Server-safe: the page says which tab is active.
 * @param props
 * @param props.tabs - In display order.
 * @param props.active - URL of the current tab.
 */
export function PageTabs({ tabs, active }: { tabs: PageTab[]; active: string }) {
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-border/70">
      {tabs.map((tab) => {
        const isActive = tab.url === active;
        return (
          <Link
            key={tab.url}
            href={tab.url}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors',
              isActive ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon && <tab.icon className="size-3.5" aria-hidden />}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
