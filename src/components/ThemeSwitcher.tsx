'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export const ThemeSwitcher = () => {
  const t = useTranslations('ThemeSwitcher');
  const { theme, setTheme } = useTheme();

  const handleChange = (nextTheme: string) => {
    if (nextTheme === theme) {
      return;
    }

    setTheme(nextTheme);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('button_label')}>
          <Sun className="size-6 dark:hidden" />
          <Moon className="hidden size-6 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={theme} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="light">{t('theme_light_label')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('theme_dark_label')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('theme_system_label')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
