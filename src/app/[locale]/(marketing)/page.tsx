import { redirect } from 'next/navigation';

type IndexProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Logged-out landing → the /solve marketing page. Authenticated users are
 * caught upstream by middleware and routed to /dashboard instead, so this
 * redirect only fires for the public homepage hit.
 * @param props
 */
export default async function Index(props: IndexProps) {
  const { locale } = await props.params;
  redirect(`/${locale}/solve`);
}
