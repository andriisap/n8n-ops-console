// Code node "Finished ids" in ops-cost-collector (mode: run once for all items).
// Input: one item per page of GET /api/v1/executions (pagination on), each {data, nextCursor}.
// Output: ONE item {ids, listed} with the ids of finished executions.
// Running ones are already left out by the API; waiting ones are left out here and
// picked up by a later run once they finish.
const FINISHED = new Set(['success', 'error', 'crashed', 'canceled']);
const ids = new Set();
let listed = 0;
for (const page of $input.all()) {
  for (const e of page.json?.data ?? []) {
    listed++;
    if (e?.id != null && FINISHED.has(e.status)) ids.add(String(e.id));
  }
}
return [{ json: { ids: [...ids], listed } }];
