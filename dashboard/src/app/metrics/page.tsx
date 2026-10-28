import Link from 'next/link';
import { ClassLabel } from '@/components/Badges';
import FailuresChart from '@/components/FailuresChart';
import MetricsFilters from '@/components/MetricsFilters';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState, Section, Stat } from '@/components/ui/card';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { CLASS_FILL, isErrorClass } from '@/lib/error-classes';
import { ago, count, duration, exact, percent } from '@/lib/format';
import { incidentQuery, type ErrorClass } from '@/lib/incident-filter';
import {
  byClass,
  daily,
  filterQuery,
  parseFilter,
  summary,
  topNodes,
  workflowOptions,
  type MetricsFilter,
} from '@/lib/metrics';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Metrics · n8n Ops Console' };

// The incident list with the same scope as the metrics: every status, same workflow and period.
const incidentsHref = (f: MetricsFilter, errorClass: ErrorClass | null = null, workflow = f.workflow) =>
  '/' + incidentQuery({ status: 'all', workflow, errorClass, days: f.days, q: null });

function Trend({ now, before, days }: { now: number; before: number; days: number }) {
  if (now === 0 && before === 0) return <>none in the period before either</>;
  if (before === 0) return <>nothing in the {days} days before</>;
  const delta = now - before;
  if (delta === 0) return <>same as the {days} days before</>;
  return (
    <span className={delta > 0 ? 'text-open' : 'text-resolved'}>
      {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs the {days} days before
    </span>
  );
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; wf?: string; test?: string }>;
}) {
  const f = parseFilter(await searchParams);
  const pool = db();
  const [s, days, classes, nodes, workflows] = await Promise.all([
    summary(pool, f),
    daily(pool, f),
    byClass(pool, f),
    topNodes(pool, f, 10),
    workflowOptions(pool),
  ]);
  const period = `last ${f.days} days`;
  const recoveredShare = s.retried > 0 ? s.recover.n / s.retried : null;
  const filtered = Boolean(f.workflow || f.hideTest);

  return (
    <main>
      <PageHeader title="Metrics">
        Original failures only: retries of a failure are its history. Ignored incidents left out. UTC days.
      </PageHeader>

      <MetricsFilters f={f} workflows={workflows} />

      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3" data-testid="metric-tiles">
        <Stat label={`Failures, ${period}`} value={count(s.failures)}>
          <Trend now={s.failures} before={s.failures_before} days={f.days} />
        </Stat>
        <Stat label="Time to recover, median" value={duration(s.recover.median_s)}>
          {s.recover.n === 0 ? (
            'no automatic recoveries'
          ) : (
            <>
              p90 {duration(s.recover.p90_s)} · {s.recover.n} of {s.retried} retried recovered
              {recoveredShare !== null && ` (${percent(recoveredShare)})`}
            </>
          )}
        </Stat>
        <Stat label="Time to resolve, median" value={duration(s.resolve.median_s)}>
          {s.resolve.n === 0
            ? 'nothing resolved in the period'
            : `p90 ${duration(s.resolve.p90_s)} · ${s.resolve.n} resolved · includes time to notice`}
          {s.resolve.backfilled > 0 && (
            <span className="text-cls-rate-limit"> · {s.resolve.backfilled} reconstructed</span>
          )}
        </Stat>
        <Stat label="Incidents with failures" value={count(s.incidents_hit)}>
          {s.incidents_new} new in the period
        </Stat>
      </div>

      {s.failures === 0 ? (
        <Card>
          <EmptyState>
            No failures in the {period}
            {filtered ? ' for this filter' : ''}.
            {(filtered || f.days === 7) && (
              <div className="mt-1.5 text-xs">
                {f.days === 7 && <Link href={`/metrics${filterQuery(f, { days: 30 })}`}>Look at 30 days</Link>}
                {f.days === 7 && filtered && ' · '}
                {filtered && <Link href="/metrics">Clear filters</Link>}
              </div>
            )}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Section title={`Failures per day, ${period}`}>
            <Card className="overflow-visible p-4 pb-2">
              <FailuresChart days={days} />
            </Card>
          </Section>

          <div className="grid gap-x-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Section title="By error class">
              <Card>
                <ul className="m-0 list-none px-4 pt-1 pb-3">
                  {[...classes]
                    .filter((c) => isErrorClass(c.error_class))
                    .sort((a, b) => b.failures - a.failures)
                    .map((c) => {
                      const cls = c.error_class as ErrorClass;
                      return (
                        <li key={cls} className="grid grid-cols-[96px_1fr_72px] items-center gap-2.5 py-1.5">
                          <Link href={incidentsHref(f, cls)} className="text-inherit">
                            <ClassLabel value={cls} />
                          </Link>
                          <div className="h-2.5 overflow-hidden rounded bg-surface-2" aria-hidden>
                            <div
                              className={cn('h-full rounded-r', CLASS_FILL[cls])}
                              style={{ width: `${Math.max(c.share * 100, 2)}%` }}
                            />
                          </div>
                          <span className="text-right font-mono whitespace-nowrap">
                            {c.failures} · {percent(c.share)}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </Card>
              <p className="mt-2 text-xs text-muted">
                transient and rate_limit are retried automatically; auth and validation need a fix, then Replay.
              </p>
            </Section>

            <Section title={`Failing nodes, ${period}`}>
              <Card>
                <Table fit>
                  <thead>
                    <TableRow>
                      <TableHead>Workflow · node</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead numeric>Failures</TableHead>
                      <TableHead className="max-md:hidden">Last</TableHead>
                    </TableRow>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <TableRow key={`${n.workflow_id}/${n.node_name}`} data-testid="failing-node">
                        <TableCell>
                          <Link href={incidentsHref(f, null, n.workflow_id)} className="font-semibold">
                            {n.workflow_name}
                          </Link>
                          {n.node_name && <span className="text-muted"> · {n.node_name}</span>}
                          {n.incidents > 1 && <div className="text-xs text-muted">{n.incidents} incidents</div>}
                        </TableCell>
                        <TableCell>
                          {isErrorClass(n.top_class) ? <ClassLabel value={n.top_class} /> : n.top_class}
                        </TableCell>
                        <TableCell numeric>{n.failures}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted max-md:hidden" title={exact(n.last_at)}>
                          {ago(n.last_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </Section>
          </div>
        </>
      )}
    </main>
  );
}
