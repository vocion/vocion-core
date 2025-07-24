import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export const requireOrganization = async () => {
  const { orgId, has } = await auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  return { orgId, has };
};
