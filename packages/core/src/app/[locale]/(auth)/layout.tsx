import { headers } from 'next/headers';
import { AuthProviders } from '@/features/navigation/AuthProviders';
import { auth } from '@/libs/Auth';
import { WORKSPACE_HEADER } from '@/libs/links';

/**
 * The signed-in shell. Reads the workspace the canonical URL names — the
 * proxy (`src/proxy.ts`) resolved the slug and set it on the request — and
 * hands it to the client context that every link builder reads. A page
 * reached without a workspace (onboarding, the demo sandbox) gets null and
 * plain, unprefixed links.
 *
 * The session is read here too and handed down, so the avatar and the unread
 * count render with the page instead of waiting on `/api/auth/session`, which
 * the client used to fetch twice before either could show.
 * @param props - `children`: the page.
 * @param props.children - The page.
 */
export default async function AuthLayout(props: {
  children: React.ReactNode;
}) {
  const [requestHeaders, session] = await Promise.all([headers(), auth()]);
  const slug = requestHeaders.get(WORKSPACE_HEADER.slug)?.trim() || null;

  return <AuthProviders session={session} workspaceSlug={slug}>{props.children}</AuthProviders>;
}
