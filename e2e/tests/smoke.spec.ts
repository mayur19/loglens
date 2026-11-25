import { expect, test } from '@playwright/test';

const OWNER = { email: 'owner@acme.test', password: 'loglens-demo-password' };

test.describe('search slice smoke', () => {
  test.skip(!process.env.E2E_ENABLED, 'Set E2E_ENABLED=1 with the dev stack running to execute');

  test('signs in, runs a LensQL stats query and sees results', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();

    await page.getByLabel('LensQL query').fill('level=error | stats count() by service');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByText('Statistics')).toBeVisible();
    await expect(page.getByRole('img', { name: /Event histogram/ })).toBeVisible();
  });

  test('shows the position of a query error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('LensQL query').fill('level=error | bogus');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.locator('mark')).toHaveText('bogus');
  });
});
