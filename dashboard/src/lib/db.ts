import { Pool } from 'pg';

// One pool per server process. In dev, Next reloads modules on every change,
// so the pool is parked on globalThis to avoid leaking connections.
const globalForPool = globalThis as unknown as { opsPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool({
    connectionString,
    max: 5,                        // ops-db is shared with n8n; keep our share small
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'ops-dashboard',
  });
}

export function db(): Pool {
  if (!globalForPool.opsPool) globalForPool.opsPool = createPool();
  return globalForPool.opsPool;
}
