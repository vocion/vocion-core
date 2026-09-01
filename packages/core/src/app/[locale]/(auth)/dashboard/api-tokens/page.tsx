import { redirect } from 'next/navigation';
import { ApiTokensPanel } from '@/features/api-tokens/ApiTokensPanel';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * API tokens page — admin only.
 *
 * A token acts with the `owner` workspace role, so a non-admin who could issue
 * one would be handing themselves permissions they do not otherwise have. The
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
        title="API tokens"
        description="Credentials for calling Vocion from outside the dashboard"
      />

      <DashboardSection
        title="Tokens"
        description="Send one in the Authorization header as a bearer token to the REST API at /api/v1 or to the MCP endpoint at /api/mcp. The secret is shown once, when you create it."
      >
        <ApiTokensPanel />
      </DashboardSection>
    </>
  );
}
