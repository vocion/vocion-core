import { clerkSetup } from '@clerk/testing/playwright';
import { test as setup } from '@playwright/test';
import { createUserWithOrganization } from './TestUtils';

setup('Create a new user in test mode with organization', async ({ page }) => {
  await clerkSetup();
  await createUserWithOrganization(page);
});
