import { redirect } from 'next/navigation';
import { ApiTokensPanel } from '@/features/api-tokens/ApiTokensPanel';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * API credentials page — admin only.
 *
 * Holds both directions: Vocion tokens an outside caller presents to us, and
 * the workspace's own keys for platforms we call out to.
 *
 * A Vocion token acts with the `owner` workspace role, and a stored platform
 * key decides whose account a model run bills, so a non-admin who could add
 * either would be handing themselves something they do not otherwise have. The
 * router enforces the same check; this redirect is so a member who guesses the
 * URL lands somewhere sensible instead of on an empty page full of errors.
 */
export default async function ApiTokensPage() {
  const { has } = await requireOrganization();

  if (!has({ role: ORG_ROLE.ADMIN })) {
    redirect('/dashboard');
  }

  return (
    <>
      <TitleBar
        title="API credentials"
        description="Tokens for calling Vocion, and your own keys for the platforms Vocion calls"
      />

      <DashboardSection
        title="Credentials"
        description="A Vocion token authenticates a caller into this workspace — send it as a bearer token to /api/v1 or /api/mcp, and copy it when you create it because it is shown only once. A key for any other platform goes the other way: Vocion uses it to call that platform on your behalf, so the run bills your account instead of ours."
      >
        <ApiTokensPanel />
      </DashboardSection>
    </>
  );
}
