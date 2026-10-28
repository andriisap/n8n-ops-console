import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// The tests talk to the database as the owner (PG* env vars), the dashboard as its own
// restricted role. reseed() puts every table back to e2e/seed.sql.
// One pool per worker process, opened on first use: every spec file closes it when done.
let pool: pg.Pool | null = null;
const db = () => (pool ??= new pg.Pool({ max: 2 }));
const SEED = readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');

export async function reseed() {
  await db().query(SEED);
}

export async function query<T extends pg.QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]> {
  return (await db().query<T>(sql, values)).rows;
}

export async function incidentId(fingerprint: string): Promise<number> {
  const rows = await query<{ id: number }>('SELECT id::int FROM incidents WHERE fingerprint = $1', [fingerprint]);
  return rows[0].id;
}

export async function close() {
  await pool?.end();
  pool = null;
}
