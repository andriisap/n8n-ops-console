import { expect, test } from '@playwright/test';
import { close, reseed } from './db';

test.beforeAll(reseed);
test.afterAll(close);

test('metrics tiles from the seeded week', async ({ page }) => {
  await page.goto('/metrics');
  const tiles = page.getByTestId('metric-tiles');
  await expect(tiles).toContainText('Failures, last 7 days');
  await expect(tiles).toContainText('15'); // canary left out: it is ignored
  await expect(tiles).toContainText('2 of 3 retried recovered');
  await expect(tiles).toContainText('2 resolved');
});

test('a class share links to the incidents of that class', async ({ page }) => {
  await page.goto('/metrics');
  await page
    .getByRole('link', { name: /rate_limit/ })
    .first()
    .click();
  await expect(page).toHaveURL(/class=rate_limit/);
  await expect(page.getByTestId('incident-row')).toHaveCount(1);
});

test('hiding test workflows and picking a workflow are links too', async ({ page }) => {
  await page.goto('/metrics?days=30');
  await page.getByRole('combobox', { name: 'Workflow' }).click();
  await page.getByRole('option', { name: 'weekly-report' }).click();
  await expect(page).toHaveURL(/days=30&wf=wf-rep/);
  await expect(page.getByTestId('failing-node')).toHaveCount(1);

  await page.goto('/metrics?wf=wf-nothing');
  await expect(page.getByText('No failures in the last 7 days for this filter.')).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/metrics$/);
});

test('costs: the long ticket is the most expensive run, the chart has exact numbers on hover', async ({ page }) => {
  await page.goto('/costs');
  const first = page.getByTestId('expensive-run').first();
  await expect(first).toContainText('t-long');
  await expect(first).toContainText('$0.00138');

  const bar = page.getByTestId('bar').last();
  await bar.hover();
  await expect(bar.getByRole('tooltip')).toContainText('calls');
});
