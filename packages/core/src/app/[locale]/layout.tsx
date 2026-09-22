import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import { Inter, Outfit } from 'next/font/google';
import { notFound } from 'next/navigation';
import { titlePrefix } from '@/libs/envLabel';
import { routing } from '@/libs/I18nRouting';
import { AppConfig } from '@/utils/AppConfig';
import '@/styles/global.css';

// v0.3 — typography stack ported from rev-ai.
// Outfit drives display headings (h1–h4 + `.font-display`).
// Inter drives body text (default `font-sans`).
// Both are loaded once at the root layout so every locale subtree
// picks them up via the `--font-outfit` / `--font-inter` CSS variables
// referenced in `styles/global.css`.
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  weight: ['200', '300', '400', '500', '600', '700'],
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

// Icons are wired via the auto-discovered `app/icon.tsx` +
// `app/apple-icon.tsx` files — they render the Vocion mark
// dynamically at the right sizes. No static icons config needed.
/**
 * Every page title carries the environment, when there is one to carry.
 *
 * `template` applies to any child route that sets a string title; `default`
 * covers the ones that set none. In production `titlePrefix()` is empty and
 * this is the same object it always was.
 */
export const metadata: Metadata = {
  title: {
    template: `${titlePrefix()}%s`,
    default: `${titlePrefix()}${AppConfig.name}`,
  },
  // Added to the Home Screen this opens without browser chrome — and on iOS
  // that is also the only way the app can ever receive a push, so it is the
  // prerequisite for telling somebody their decision is holding work up.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: AppConfig.name },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The installed app draws under the notch and the home indicator rather
  // than letterboxing itself inside them.
  viewportFit: 'cover',
};

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export default async function RootLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;

  if (!routing.locales.includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning className={`${outfit.variable} ${inter.variable}`}>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <NextIntlClientProvider>
            {props.children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
