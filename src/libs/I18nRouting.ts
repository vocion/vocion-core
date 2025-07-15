import { defineRouting } from 'next-intl/routing';
import { AllLocales, AppConfig } from '@/utils/AppConfig';

export const routing = defineRouting({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});
