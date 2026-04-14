import { test as teardown } from '@playwright/test';
import { deleteUserWithOrganization } from './TestUtils';

teardown('Remove the user created in test mode', async () => {
  await deleteUserWithOrganization();
});
