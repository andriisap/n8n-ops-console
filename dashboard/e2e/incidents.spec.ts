import { expect, test } from '@playwright/test';
import { close, incidentId, query, reseed } from './db';

test.beforeAll(reseed);
test.afterAll(close);

test('open incidents by default, counts on every status tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('incident-row')).toHaveCount(3);
  const tabs = page.getByRole('navigation', { name: 'Filter by status' });
  await expect(tabs.getByRole('link', { name: /Open/ })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Resolved 2' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Ignored 1' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'All 6' })).toBeVisible();
});

test('filters live in the URL and narrow the tab counts', async ({ page }) => {
  await page.goto('/?status=all');
  await page.getByRole('combobox', { name: 'Error class' }).click();
  await page.getByRole('option', { name: 'transient' }).click();
  await expect(page).toHaveURL(/class=transient/);
  await expect(page.getByTestId('incident-row')).toHaveCount(1);
  await expect(page.getByTestId('incident-row')).toContainText('order-shipping');
  await expect(page.getByRole('link', { name: 'All 1' })).toBeVisible();

  // The same view from a pasted link.
  await page.goto('/?status=all&class=transient');
  await expect(page.getByTestId('incident-row')).toHaveCount(1);

  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/\?status=all$/);
  await expect(page.getByTestId('incident-row')).toHaveCount(6);
});

test('text search on Enter, with a helpful empty state', async ({ page }) => {
  await page.goto('/?status=all');
  await page.getByRole('searchbox', { name: 'Search' }).fill('HubSpot');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=HubSpot/);
  await expect(page.getByTestId('incident-row')).toHaveCount(1);

  await page.goto('/?status=all&q=no-such-thing');
  await expect(page.getByText('No incidents match these filters.')).toBeVisible();
});

test('an incident shows its events and the cost of the replay that fixed it', async ({ page }) => {
  await page.goto(`/incidents/${await incidentId('fp-groq')}`);
  await expect(page.getByRole('heading', { level: 2 })).toContainText('demo-ticket-triage');
  await expect(page.getByTestId('recovered')).toHaveText(/replay succeeded \(3011\) · \$0\.00013 for 2 LLM calls/);
  await expect(page.getByRole('link', { name: /3001/ })).toHaveAttribute(
    'href',
    'https://n8n.example.com/workflow/wf-triage/executions/3001',
  );
});

test('Replay queues one manual job, even when clicked twice', async ({ page }) => {
  const id = await incidentId('fp-json');
  await page.goto(`/incidents/${id}`);
  const replay = page.getByRole('button', { name: 'Replay' }).first();
  await replay.dblclick();
  await expect(page.getByText('replay queued')).toBeVisible();
  const jobs = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM retry_queue WHERE incident_id = $1 AND kind = 'manual'",
    [id],
  );
  expect(jobs[0].n).toBe(1);
});

test('Resolve and Reopen change the status, and the log records who did it', async ({ page }) => {
  const id = await incidentId('fp-429');
  await page.goto(`/incidents/${id}`);
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('open', { exact: true })).toBeVisible();

  const log = await query<{ to_status: string; changed_by: string }>(
    'SELECT to_status, changed_by FROM incident_status_log WHERE incident_id = $1 ORDER BY id',
    [id],
  );
  expect(log.slice(-2)).toEqual([
    { to_status: 'resolved', changed_by: 'ops_dashboard' },
    { to_status: 'open', changed_by: 'ops_dashboard' },
  ]);
});

test('unknown incident and unknown page are a clean 404', async ({ page }) => {
  for (const path of ['/incidents/999999', '/incidents/abc', '/nope']) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  }
});
