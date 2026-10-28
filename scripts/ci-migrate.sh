#!/usr/bin/env bash
# Applies every migration and the price list to the database in PG* env vars, then gives the
# dashboard role a known test password. For CI and scratch databases only.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in infra/migrations/*.sql infra/prices/model_prices.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
  echo "applied $f"
done
psql -X -q -v ON_ERROR_STOP=1 -c "ALTER ROLE ops_dashboard PASSWORD '${PGDASHPASS:-devpass}'"
