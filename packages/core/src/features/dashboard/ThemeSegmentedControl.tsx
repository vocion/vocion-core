'use client';

import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useId, useRef } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';

const THEMES: { value: 'light' | 'dark' | 'system'; icon: LucideIcon }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/**
 * Light / Dark / System as one row of the account menu, picked in one click:
 * three icons, each named by its tooltip and its accessible label.
 * It was a "Theme ▸" submenu: two moves to change it and no way to see the
 * current choice without opening it.
 *
 * A radiogroup, keyboard-first: Tab reaches the chosen option (the group is
 * one tab stop, as WAI-ARIA's radio group pattern has it), ←/→ (and ↑/↓, Home, End) move between options, Enter or
 * Space picks the focused one. Picking applies at once and leaves the menu
 * open. Keys are kept from the surrounding menu so its own arrow and
 * typeahead handling do not steal them; Escape still closes it.
 *
 * Persistence is next-themes', as before (localStorage `theme`).
 */
export function ThemeSegmentedControl() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('ThemeSwitcher');
  const current = THEMES.some(o => o.value === theme) ? theme : 'light';
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const labels = { light: t('theme_light_label'), dark: t('theme_dark_label'), system: t('theme_system_label') };

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = refs.current.indexOf(event.currentTarget);
    const last = THEMES.length - 1;
    const next = ({
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    } as Record<string, number>)[event.key];
    if (event.key === 'Tab') {
      // Leave the group for the menu's items, the way Tab left it.
      event.preventDefault();
      event.stopPropagation();
      tabOut(event.currentTarget, event.shiftKey);
      return;
    }
    if (event.key === 'Escape') {
      return;
    }
    event.stopPropagation();
    if (next !== undefined) {
      event.preventDefault();
      refs.current[next]?.focus();
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span id={labelId} className="flex items-center gap-2 text-sm">
        <SunMoon className="mr-2 size-4 text-muted-foreground" aria-hidden />
        {t('theme_label')}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        data-theme-control=""
        className="flex items-center gap-0.5 rounded-lg bg-surface-soft p-0.5"
      >
        {THEMES.map((option, i) => {
          const checked = option.value === current;
          const Icon = option.icon;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={labels[option.value]}
                  tabIndex={checked ? 0 : -1}
                  onKeyDown={onKeyDown}
                  onClick={() => setTheme(option.value)}
                  data-testid={`theme-${option.value}`}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    checked ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{labels[option.value]}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The menu's items in document order — Radix's own roving focus covers them.
 * @param menu - The `role="menu"` element.
 */
function menuItems(menu: Element): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])')];
}

/**
 * Move focus from the theme group to the nearest menu item after it (Tab) or
 * before it (Shift+Tab).
 * @param radio - The focused option.
 * @param back - Shift was held.
 */
function tabOut(radio: HTMLElement, back: boolean) {
  const group = radio.closest('[role="radiogroup"]');
  const menu = radio.closest('[role="menu"]');
  if (!group || !menu) {
    return;
  }
  const items = menuItems(menu);
  const after = items.filter(el => group.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = items.filter(el => group.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
  const target = back ? (before.at(-1) ?? after.at(-1)) : (after[0] ?? before[0]);
  target?.focus();
}

/**
 * The account menu's Tab handler: a menu swallows Tab (its items move with
 * the arrows), which would leave the theme control unreachable from the
 * keyboard. Tab from any item lands on the control's chosen option instead.
 * Pass as the menu content's `onKeyDown`.
 * @param event - The keydown on the menu content.
 */
export function tabToThemeControl(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') {
    return;
  }
  const radio = event.currentTarget.querySelector<HTMLElement>('[data-theme-control] [role="radio"][tabindex="0"]');
  if (radio) {
    event.preventDefault();
    radio.focus();
  }
}
