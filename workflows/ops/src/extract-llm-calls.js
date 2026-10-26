// Code node "Extract LLM calls" in ops-cost-collector (mode: run once for all items).
// Each input item is one execution from GET /api/v1/executions/{id}?includeData=true.
// Output: ONE item {executions: [...], calls: [...]} for record-llm-usage.sql.
//
// Where the numbers come from (n8n 2.42.5, @n8n/ai-utilities n8n-llm-tracing.ts):
// every model sub-node (Anthropic Chat Model, Groq Chat Model, ...) writes one run per
// LLM call with data.ai_languageModel[0][0].json = { response, tokenUsage } — or
// tokenUsageEstimate when the provider reported nothing (streaming). The chain node
// above it repeats the same totals in metadata.tracing; it is NOT counted, or every
// call would be counted twice.
// The model id is in the run's inputOverride (options.model), which is what was really
// sent; the node parameter can be an expression.

const FINISHED = new Set(['success', 'error', 'crashed', 'canceled']);

// Node type → provider name used in model_prices.
const PROVIDERS = {
  lmChatAnthropic: 'anthropic',
  lmChatGroq: 'groq',
  lmChatOpenAi: 'openai',
  lmOpenAi: 'openai',
  lmChatAzureOpenAi: 'azure-openai',
  lmChatGoogleGemini: 'google',
  lmChatGoogleVertex: 'google-vertex',
  lmChatMistralCloud: 'mistral',
  lmChatDeepSeek: 'deepseek',
  lmChatOpenRouter: 'openrouter',
  lmChatXAiGrok: 'xai',
  lmChatAwsBedrock: 'bedrock',
  lmChatOllama: 'ollama',
  lmChatCohere: 'cohere',
};

function providerOf(nodeType) {
  const short = String(nodeType ?? '').split('.').pop();
  return PROVIDERS[short] ?? (short.replace(/^lm(Chat)?/, '').toLowerCase() || 'unknown');
}

function modelOf(run, node) {
  const opts = run.inputOverride?.ai_languageModel?.[0]?.[0]?.json?.options ?? {};
  let m = opts.model ?? opts.modelName ?? opts.model_name ?? opts.model_id;
  if (!m) {
    const p = node?.parameters?.model;
    m = p && typeof p === 'object' ? p.value : p;
  }
  if (typeof m !== 'string' || m === '' || m.startsWith('=')) return 'unknown';
  return m.replace(/^models\//, '');
}

const int = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const executions = [];
const calls = [];
const skipped = [];

for (const item of $input.all()) {
  const e = item.json ?? {};
  const id = e.id != null ? String(e.id) : null;
  if (!id) continue;
  // Not finished yet (waiting, running): leave it for a later run instead of marking it scanned.
  if (!FINISHED.has(e.status)) { skipped.push({ id, reason: `status ${e.status}` }); continue; }
  // Over EXECUTIONS_DATA_MAX_DISPLAY_SIZE without ignoreDataSizeLimit, or redacted:
  // no data means we can't know. Skip it rather than record "no LLM calls".
  const runData = e.data?.resultData?.runData;
  if (!runData) { skipped.push({ id, reason: 'no execution data' }); continue; }

  const wf = e.workflowData ?? {};
  const nodesByName = Object.fromEntries((wf.nodes ?? []).map((n) => [n.name, n]));
  const startedAt = e.startedAt ?? e.createdAt;
  let found = 0;

  for (const [nodeName, runs] of Object.entries(runData)) {
    (runs ?? []).forEach((run, runIndex) => {
      const out = run?.data?.ai_languageModel?.[0]?.[0]?.json;
      if (!out) return;                               // not a model node, or the call failed
      const usage = out.tokenUsage ?? out.tokenUsageEstimate;
      if (!usage) return;
      const node = nodesByName[nodeName];
      calls.push({
        execution_id: id,
        workflow_id: String(e.workflowId ?? wf.id ?? ''),
        workflow_name: wf.name ?? null,
        node_name: nodeName,
        run_index: runIndex,
        provider: providerOf(node?.type),
        model: modelOf(run, node),
        // Anthropic: n8n folds cache reads and writes into promptTokens, so they can't be
        // priced separately (decision 030).
        input_tokens: int(usage.promptTokens),
        output_tokens: int(usage.completionTokens),
        estimated: !out.tokenUsage,
        execution_status: e.status,
        started_at: startedAt,
      });
      found++;
    });
  }

  executions.push({
    execution_id: id,
    workflow_id: String(e.workflowId ?? wf.id ?? ''),
    workflow_name: wf.name ?? null,
    execution_status: e.status,
    started_at: startedAt,
    llm_calls: found,
  });
}

return [{ json: { executions, calls, skipped } }];
