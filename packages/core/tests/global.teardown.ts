import { test as teardown } from '@playwright/test';
import { deleteAdminUser } from './TestUtils';

teardown('Remove the user created for the run', () => {
  deleteAdminUser();
});
