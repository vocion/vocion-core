import type { Metadata } from 'next';
import { AppShell } from '@/features/dashboard/AppShell';

/**
 * `/gtm/*` — the go-to-market surfaces. Its own top-level segment rather than
 * a folder under `/dashboard`, so the URL names the section the sidebar
 * groups it under. Same shell as the dashboard.
 */

type GtmLayoutProps = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export const metadata: Metadata = {
  title: 'GTM',
};

export default async function GtmLayout(props: GtmLayoutProps) {
  const { locale } = await props.params;

  return <AppShell locale={locale}>{props.children}</AppShell>;
}
