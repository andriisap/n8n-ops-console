// Code node "Build budget alert" in ops-cost-collector (mode: run once for each item).
// Input: one row from check-budget.sql. Output: {text} for Telegram, HTML parse mode.
const r = $json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (v) => {
  if (v === null || v === undefined || v === '') return 'no price';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'no price';
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(5)}`;
};

const lines = [
  `💸 <b>LLM budget exceeded</b> · ${esc(r.day)} (UTC)`,
  `Spent ${usd(r.spent)} of ${usd(r.threshold)} today: ${r.calls} calls in ${r.runs} runs.`,
];
const top = Array.isArray(r.workflows) ? r.workflows : [];
if (top.length) {
  lines.push('', 'Top workflows:');
  for (const w of top) lines.push(`• ${esc(w.workflow_name || '(unnamed)')}: ${usd(w.cost)} in ${w.runs} runs`);
}
if (Number(r.unpriced) > 0) {
  lines.push('', `⚠️ ${r.unpriced} calls have no price yet, so real spend is higher.`);
}
lines.push('', 'One message per day. The dashboard shows each run.');
return { json: { text: lines.join('\n'), day: r.day, kind: r.kind } };
