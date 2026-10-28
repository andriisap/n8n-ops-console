import Link from 'next/link';
import { ClassLabel } from '@/components/Badges';
import FailuresChart, { CLASS_ORDER } from '@/components/FailuresChart';
import MetricsFilters from '@/components/MetricsFilters';
import { db } from '@/lib/db';
import { ago, count, duration, exact, percent } from '@/lib/format';
import type { ErrorClass } from '@/lib/incidents';
import { byClass, daily, filterQuery, parseFilter, summary, topNodes, workflowOptions, type MetricsFilter } from '@/lib/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Metrics · n8n Ops Console' };

// Link to the incident list with the same scope (filters on / arrive in stage 7 step 4).
function incidentsHref(f: MetricsFilter, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ status: 'all', ...extra });
  if (f.workflow) q.set('wf', f.workflow);
  q.set('days', String(f.days));
  return `/?${q}`;
}

export default async function MetricsPage({ searchParams }: {
  searchParams: Promise<{ days?: string; wf?: string; test?: string }>;
}) {
  const f = parseFilter(await searchParams);
  const pool = db();
  const [s, days, classes, nodes, workflows] = await Promise.all([
    summary(pool, f), daily(pool, f), byClass(pool, f), topNodes(pool, f, 10), workflowOptions(pool),
  ]);
  const period = `last ${f.days} days`;
  const delta = s.failures - s.failures_before;
  const recoveredShare = s.retried > 0 ? s.recover.n / s.retried : null;

  return (
    <main>
      <div className="head">
        <div>
          <h2>Metrics</h2>
          <div className="sub">
            <span>Original failures only: retries of a failure are its history. Ignored incidents left out. UTC days.</span>
          </div>
        </div>
      </div>

      <MetricsFilters f={f} workflows={workflows} />

      <div className="stats">
        <div className="stat">
          <div className="k">Failures, {period}</div>
          <div className="v">{count(s.failures)}</div>
          <div className="stat-sub">
            {s.failures_before === 0 && s.failures === 0 ? 'none in the period before either'
              : delta === 0 ? `same as the ${f.days} days before`
              : <span className={delta > 0 ? 'trend-up' : 'trend-down'}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs the {f.days} days before</span>}
          </div>
        </div>
        <div className="stat">
          <div className="k">Time to recover, median</div>
          <div className="v">{duration(s.recover.median_s)}</div>
          <div className="stat-sub">
            {s.recover.n === 0 ? 'no automatic recoveries'
              : <>p90 {duration(s.recover.p90_s)} · {s.recover.n} of {s.retried} retried recovered{recoveredShare !== null && ` (${percent(recoveredShare)})`}</>}
          </div>
        </div>
        <div className="stat">
          <div className="k">Time to resolve, median</div>
          <div className="v">{duration(s.resolve.median_s)}</div>
          <div className="stat-sub">
            {s.resolve.n === 0 ? 'nothing resolved in the period'
              : <>p90 {duration(s.resolve.p90_s)} · {s.resolve.n} resolved · includes time to notice</>}
            {s.resolve.backfilled > 0 && <span className="warn"> · {s.resolve.backfilled} reconstructed</span>}
          </div>
        </div>
        <div className="stat">
          <div className="k">Incidents with failures</div>
          <div className="v">{count(s.incidents_hit)}</div>
          <div className="stat-sub">{s.incidents_new} new in the period</div>
        </div>
      </div>

      {s.failures === 0 ? (
        <div className="card">
          <div className="empty">
            No failures in the {period}{f.workflow || f.hideTest ? ' for this filter' : ''}.
            {(f.workflow || f.hideTest || f.days === 7) && (
              <div className="small" style={{ marginTop: 6 }}>
                {f.days === 7 && <Link href={`/metrics${filterQuery(f, { days: 30 })}`}>Look at 30 days</Link>}
                {f.days === 7 && (f.workflow || f.hideTest) && ' · '}
                {(f.workflow || f.hideTest) && <Link href="/metrics">Clear filters</Link>}
              </div>
            )}
          </div>
        </div>
      ) : (<>
      <section className="section">
        <h3>Failures per day, {period}</h3>
        <div className="card pad">
          <FailuresChart days={days} />
        </div>
      </section>

      <div className="grid-2">
        <section className="section">
          <h3>By error class</h3>
          <div className="card">
            {(
              <ul className="shares">
                {CLASS_ORDER.filter((c) => classes.some((x) => x.error_class === c))
                  .map((c) => classes.find((x) => x.error_class === c)!)
                  .sort((a, b) => b.failures - a.failures)
                  .map((c) => (
                    <li key={c.error_class}>
                      <Link href={incidentsHref(f, { class: c.error_class })}><ClassLabel value={c.error_class as ErrorClass} /></Link>
                      <div className="share-track" aria-hidden="true">
                        <div className={`share-fill f-${c.error_class}`} style={{ width: `${Math.max(c.share * 100, 2)}%` }} />
                      </div>
                      <span className="num">{c.failures} · {percent(c.share)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <p className="note">
            transient and rate_limit are retried automatically; auth and validation need a fix, then Replay.
          </p>
        </section>

        <section className="section">
          <h3>Failing nodes, {period}</h3>
          <div className="card">
            {(
              <div className="table-wrap"><table className="table">
                <thead>
                  <tr>
                    <th>Workflow · node</th>
                    <th>Class</th>
                    <th className="num">Failures</th>
                    <th className="hide-sm">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr key={`${n.workflow_id}/${n.node_name}`}>
                      <td>
                        <Link href={incidentsHref({ ...f, workflow: n.workflow_id })}>
                          <span className="wf">{n.workflow_name}</span>
                        </Link>
                        {n.node_name && <span className="node"> · {n.node_name}</span>}
                        {n.incidents > 1 && <div className="small muted">{n.incidents} incidents</div>}
                      </td>
                      <td><ClassLabel value={n.top_class as ErrorClass} /></td>
                      <td className="num">{n.failures}</td>
                      <td className="when hide-sm" title={exact(n.last_at)}>{ago(n.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </section>
      </div>
      </>)}
    </main>
  );
}
