import { redirect } from 'next/navigation';

/**
 * The old per-source detail URL, kept so existing links and bookmarks keep
 * working after "Sources" became "Connectors".
 * @param props - Route props.
 * @param props.params - The dynamic `[slug]` segment.
 */
export default async function SourceDetailPage(props: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug } = await props.params;
  redirect(`/dashboard/connectors/${encodeURIComponent(slug)}`);
}
