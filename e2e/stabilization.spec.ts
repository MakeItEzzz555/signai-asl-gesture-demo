import { expect, test } from '@playwright/test';

test.describe('responsive shell', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps navigation and settings controls reachable on a phone viewport', async ({ page }) => {
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const navigation = page.getByRole('complementary', { name: 'Primary navigation' });
    await expect(navigation).toBeVisible();
    await page.getByRole('link', { name: /about technical info/i }).click();
    await expect(page).toHaveURL(/\/about$/);

    const viewport = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
  });
});

test('persists a saved dataset and accessibility preferences across reload', async ({ page }) => {
  await page.goto('/dataset');
  await expect(page.getByText('Dataset saved locally')).toBeVisible();
  await page.getByRole('button', { name: /load starter dataset/i }).click();
  await expect(page.getByText('150', { exact: true })).toBeVisible();
  await expect(page.getByText('Dataset saved locally')).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Output language' }).selectOption('el');
  await page.getByRole('switch', { name: 'High contrast mode' }).click();
  await page.reload();

  await expect(page.getByRole('combobox', { name: 'Output language' })).toHaveValue('el');
  await expect(page.getByRole('switch', { name: 'High contrast mode' })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/dataset');
  await expect(page.getByText('150', { exact: true })).toBeVisible();
});

test('keeps Dataset controls usable at 320px with X-Large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'X-Large' }).click();
  await page.goto('/dataset');
  await expect(page.getByRole('button', { name: 'Start Camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: /load starter dataset/i })).toBeVisible();
  const geometry = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  const cameraButton = await page.getByRole('button', { name: 'Start Camera' }).boundingBox();
  expect(cameraButton?.width ?? 0).toBeGreaterThan(100);
});
