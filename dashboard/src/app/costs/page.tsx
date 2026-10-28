import DailyCostChart from '@/components/DailyCostChart';
import { byModel, byWorkflow, daily, collectorHealth, executionUrl, summary, topRuns, type Totals } from '@/lib/costs';
import { ago, count, exact, perMtok, usd } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Costs · n8n Ops Console' };

function Stat({ k, t, note }: { k: string; t: Totals; note?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{usd(t.cost)}</div>
      <div className="stat-sub">
        {count(t.calls)} calls · {count(t.runs)} runs
        {t.unpriced > 0 && <span className="warn"> · {t.unpriced} without price</span>}
        {note && <span> · {note}</span>}
      </div>
    </div>
  );
}

export default async function CostsPage() {
  const [s, days, workflows, models, runs, collector] = await Promise.all([
    summary(),
    daily(14),
    byWorkflow(7),
    byModel(7),
    topRuns(7, 10),
    collectorHealth(),
  ]);
  const perRun = s.last7.runs > 0 ? s.last7.cost / s.last7.runs : null;
  const { at: ranAt, stale } = collector;

  return (
    <main>
      <div className="head">
        <div>
          <h2>LLM costs</h2>
          <div className="sub">
            <span>Priced per call with the price valid on that day, UTC days.</span>
            <span title={exact(ranAt)} className={stale ? 'warn' : undefined}>
              Collector last ran {ago(ranAt)}
              {stale && ', check ops-cost-collector'}.
            </span>
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat k="Today" t={s.today} />
        <Stat k="Last 7 days" t={s.last7} />
        <Stat k="Last 30 days" t={s.last30} />
        <div className="stat">
          <div className="k">Average run, 7 days</div>
          <div className="v">{perRun === null ? '—' : usd(perRun)}</div>
          <div className="stat-sub">
            {count(s.last7.tokens_in)} in · {count(s.last7.tokens_out)} out tokens
            {s.last7.estimated > 0 && <span className="warn"> · {s.last7.estimated} estimated</span>}
          </div>
        </div>
      </div>

      {s.last30.calls === 0 ? (
        <div className="card state">
          <h2>No LLM calls in the last 30 days</h2>
          <p>Runs of any workflow with a model node show up here within a minute, priced per call.</p>
        </div>
      ) : (
        <>
          <section className="section">
            <h3>Spend per day, last 14 days</h3>
            <div className="card pad">
              <DailyCostChart days={days} />
            </div>
          </section>

          <section className="section">
            <h3>Workflows, last 7 days</h3>
            <div className="card">
              {workflows.length === 0 ? (
                <div className="empty">No LLM calls in the last 7 days.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th className="num">Runs</th>
                        <th className="num">Calls</th>
                        <th className="num hide-sm">Tokens in / out</th>
                        <th className="num">Per run</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflows.map((w) => (
                        <tr key={w.workflow_id}>
                          <td className="wf">{w.workflow_name || w.workflow_id}</td>
                          <td className="num">{count(w.runs)}</td>
                          <td className="num">{count(w.calls)}</td>
                          <td className="num hide-sm">
                            {count(w.tokens_in)} / {count(w.tokens_out)}
                          </td>
                          <td className="num">{usd(w.per_run)}</td>
                          <td className="num">
                            {usd(w.cost)}
                            {w.unpriced > 0 && <div className="warn small">{w.unpriced} without price</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <h3>Models and prices, last 7 days</h3>
            <div className="card">
              {models.length === 0 ? (
                <div className="empty">No LLM calls in the last 7 days.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th className="num">Calls</th>
                        <th className="num hide-sm">Tokens in / out</th>
                        <th className="num">Price in / out per 1M</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((m) => (
                        <tr key={`${m.provider}/${m.model}`}>
                          <td>
                            <span className="wf">{m.model}</span> <span className="node">{m.provider}</span>
                          </td>
                          <td className="num">{count(m.calls)}</td>
                          <td className="num hide-sm">
                            {count(m.tokens_in)} / {count(m.tokens_out)}
                          </td>
                          <td className="num">
                            {m.input_per_mtok === null ? (
                              <span className="warn">no price</span>
                            ) : (
                              <>
                                {perMtok(m.input_per_mtok)} / {perMtok(m.output_per_mtok)}
                                <div className="small muted">
                                  {m.price_tiers > 1 && 'base tier · '}since {m.valid_from}
                                  {m.source_url && (
                                    <>
                                      {' '}
                                      ·{' '}
                                      <a href={m.source_url} target="_blank" rel="noreferrer">
                                        source
                                      </a>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="num">{usd(m.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <h3>Most expensive runs, last 7 days</h3>
            <div className="card">
              {runs.length === 0 ? (
                <div className="empty">No LLM calls in the last 7 days.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Execution</th>
                        <th>Workflow</th>
                        <th>When</th>
                        <th className="num">Calls</th>
                        <th className="num hide-sm">Tokens in / out</th>
                        <th className="num">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => {
                        const url = executionUrl(r.workflow_id, r.execution_id);
                        return (
                          <tr key={r.execution_id}>
                            <td className="id">
                              {url ? (
                                <a href={url} target="_blank" rel="noreferrer">
                                  {r.execution_id} ↗
                                </a>
                              ) : (
                                r.execution_id
                              )}
                            </td>
                            <td>
                              <span className="wf">{r.workflow_name}</span>
                              {r.status && r.status !== 'success' && <span className="warn small"> · {r.status}</span>}
                              <div className="msg">{r.models}</div>
                            </td>
                            <td className="when" title={exact(r.started_at)}>
                              {ago(r.started_at)}
                            </td>
                            <td className="num">{r.calls}</td>
                            <td className="num hide-sm">
                              {count(r.tokens_in)} / {count(r.tokens_out)}
                            </td>
                            <td className="num">{usd(r.cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
