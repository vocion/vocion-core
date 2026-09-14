import { test as setup } from '@playwright/test';
import { seedAdminUser } from './TestUtils';

setup('Seed the E2E admin user', () => {
  seedAdminUser();
});
