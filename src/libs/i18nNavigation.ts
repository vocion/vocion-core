import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';
import { AllLocales, AppConfig } from '@/utils/AppConfig';

export const routing = defineRouting({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});

export const { usePathname, useRouter } = createNavigation(routing);
