import assert from 'node:assert';

import { clerkClient } from '@clerk/nextjs/server';
import { test as teardown } from '@playwright/test';

teardown('account and organization deletion', async () => {
  assert(process.env.E2E_CLERK_USER_USERNAME !== undefined, 'E2E_CLERK_USER_USERNAME not set');

  const { data } = await clerkClient().users.getUserList({
    emailAddress: [process.env.E2E_CLERK_USER_USERNAME],
  });

  assert(data[0] !== undefined, 'User not found');

  await clerkClient().users.deleteUser(data[0].id);
});
