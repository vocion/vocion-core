import { headers } from 'next/headers';
import { AuthProviders } from '@/features/navigation/AuthProviders';
import { WORKSPACE_HEADER } from '@/libs/links';

/**
 * The signed-in shell. Reads the workspace the canonical URL names — the
 * proxy (`src/proxy.ts`) resolved the slug and set it on the request — and
 * hands it to the client context that every link builder reads. A page
 * reached without a workspace (onboarding, the demo sandbox) gets null and
 * plain, unprefixed links.
 * @param props - `children`: the page.
 * @param props.children - The page.
 */
export default async function AuthLayout(props: {
  children: React.ReactNode;
}) {
  const slug = (await headers()).get(WORKSPACE_HEADER.slug)?.trim() || null;

  return <AuthProviders workspaceSlug={slug}>{props.children}</AuthProviders>;
}
