import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against a production build of the dashboard and a scratch Postgres with
// all migrations (PG* env vars). Each spec file reseeds the database from e2e/seed.sql.
//   npm run build && npm run e2e
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // the specs share one database
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    command: 'node scripts/serve-standalone.mjs',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        `postgres://ops_dashboard:${process.env.PGDASHPASS ?? 'devpass'}@${process.env.PGHOST?.startsWith('/') ? 'localhost' : (process.env.PGHOST ?? 'localhost')}:${process.env.PGPORT ?? 5432}/${process.env.PGDATABASE ?? 'ops'}`,
      N8N_PUBLIC_URL: 'https://n8n.example.com',
    },
  },
});
