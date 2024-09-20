import { expect, test } from '@playwright/test';

test.describe('I18n', () => {
  test.describe('Static pages', () => {
    test('should switch language from English to French and verify text on the homepage', async ({ page }) => {
      await page.goto('/');

      await expect(
        page.getByText(
          'The perfect SaaS template to build',
        ),
      ).toBeVisible();

      await page.getByRole('button', { name: 'lang-switcher' }).click();
      await page.getByText('Français').click();

      await expect(
        page.getByText(
          'Le parfait SaaS template pour construire',
        ),
      ).toBeVisible();
    });

    test('should switch language from English to French and verify text on the sign-in page', async ({ page }) => {
      await page.goto('/');
      await page.getByText('Sign in').click();

      await expect(page.getByText('Email address')).toBeVisible();

      await page.goto('/fr');
      await page.getByText('Se connecter').click();

      await expect(page.getByText('Adresse e-mail')).toBeVisible();
    });
  });
});
