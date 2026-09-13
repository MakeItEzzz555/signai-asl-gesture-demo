import { expect, test } from '@playwright/test';

test('Home renders useful content and navigation without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /ASL gesture/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /recognize/i }).first()).toBeVisible();
  await page.getByRole('link', { name: /about/i }).first().click();
  await expect(page).toHaveURL(/\/about$/);
  expect(errors).toEqual([]);
});
