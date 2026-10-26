// Code node "Finished ids" in ops-cost-collector (mode: run once for all items).
// Input: pages of GET /api/v1/executions (pagination on), each {data, nextCursor}.
// Also reads the pages of "List workflows" to know which workflows contain a model node.
//
// Output: ONE item {ids, no_llm, listed}
//   ids     finished executions of workflows WITH a model node: their data gets downloaded
//   no_llm  finished executions of workflows without one: marked scanned with 0 calls
//           straight from the listing, no download. On a live instance that is most of them
//           (error handler, chaos, schedulers), so the backlog clears 10x faster.
// A workflow is judged by its current version: an LLM node removed later means its old
// runs aren't counted (decision 032).
// Running executions are already left out by the API; waiting ones are left for later.
const FINISHED = new Set(['success', 'error', 'crashed', 'canceled']);
const MODEL_NODE = /\.lm[A-Z]|lmChat/;   // @n8n/n8n-nodes-langchain.lmChatAnthropic, .lmOpenAi, ...

let workflowPages = [];
try { workflowPages = $('List workflows').all(); } catch (e) { workflowPages = []; }
const llmWorkflows = new Set();
for (const page of workflowPages) {
  for (const wf of page.json?.data ?? []) {
    if ((wf.nodes ?? []).some((n) => MODEL_NODE.test(String(n.type ?? '')))) llmWorkflows.add(String(wf.id));
  }
}
// No workflow list at all (API change, permissions): download everything rather than miss costs.
const knowsWorkflows = workflowPages.some((p) => Array.isArray(p.json?.data));

const ids = new Set();
const noLlm = new Map();
let listed = 0;
for (const page of $input.all()) {
  for (const e of page.json?.data ?? []) {
    listed++;
    if (e?.id == null || !FINISHED.has(e.status)) continue;
    const id = String(e.id);
    if (!knowsWorkflows || llmWorkflows.has(String(e.workflowId))) ids.add(id);
    else noLlm.set(id, {
      execution_id: id,
      workflow_id: String(e.workflowId ?? ''),
      execution_status: e.status,
      started_at: e.startedAt ?? e.createdAt,
    });
  }
}
return [{ json: { ids: [...ids], no_llm: [...noLlm.values()], listed } }];
