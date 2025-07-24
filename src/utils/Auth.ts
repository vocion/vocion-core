/**
 * Authentication utilities for Next.js App Router. These functions use Next.js `redirect()`.
 *
 * Naming Convention: `require*` functions ensure users are in the correct state
 * by redirecting them if authentication/authorization fails.
 *
 * For API/RPC authentication, use AuthGuards.ts (`guard*` functions) instead.
 */
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

/**
 * Ensures the user belongs to an organization.
 * Redirects to organization selection if no organization is found.
 *
 * @returns Promise containing orgId and has function for role checking
 * @throws Redirects to organization selection if no orgId
 */
export const requireOrganization = async () => {
  const { orgId, has } = await auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  return { orgId, has };
};
