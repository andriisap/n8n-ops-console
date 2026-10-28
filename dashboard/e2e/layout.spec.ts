import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { close, reseed } from './db';

test.beforeAll(reseed);
test.afterAll(close);

const PAGES = ['/', '/?status=all', '/metrics', '/metrics?days=30', '/costs'];

for (const path of PAGES) {
  test(`${path}: no sideways scroll, no serious accessibility issues, in both themes`, async ({ page, context }) => {
    for (const theme of ['light', 'dark']) {
      await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost' }]);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'page wider than the screen').toBeLessThanOrEqual(0);

      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
    }
  });
}

test('theme switch cycles and survives a reload without a flash', async ({ page }) => {
  await page.goto('/');
  const sw = page.getByTestId('theme-switch');
  await expect(sw).toContainText('system');
  await sw.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await sw.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The server renders the saved theme into the first HTML byte.
  const html = await (await page.request.get('/')).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);

  await sw.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});
