import DailyCostChart from '@/components/DailyCostChart';
import { ExternalLink } from '@/components/ExternalLink';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState, Section, Stat } from '@/components/ui/card';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { byModel, byWorkflow, collectorHealth, daily, executionUrl, summary, topRuns, type Totals } from '@/lib/costs';
import { ago, count, exact, perMtok, usd } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Costs · n8n Ops Console' };

const Warn = ({ children }: { children: React.ReactNode }) => <span className="text-cls-rate-limit">{children}</span>;

function Spend({ label, t }: { label: string; t: Totals }) {
  return (
    <Stat label={label} value={usd(t.cost)}>
      {count(t.calls)} calls · {count(t.runs)} runs
      {t.unpriced > 0 && <Warn> · {t.unpriced} without price</Warn>}
    </Stat>
  );
}

const NO_CALLS = <EmptyState>No LLM calls in the last 7 days.</EmptyState>;

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
      <PageHeader title="LLM costs">
        <span>Priced per call with the price valid on that day, UTC days.</span>
        <span title={exact(ranAt)} className={stale ? 'text-cls-rate-limit' : undefined}>
          Collector last ran {ago(ranAt)}
          {stale && ', check ops-cost-collector'}.
        </span>
      </PageHeader>

      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Spend label="Today" t={s.today} />
        <Spend label="Last 7 days" t={s.last7} />
        <Spend label="Last 30 days" t={s.last30} />
        <Stat label="Average run, 7 days" value={perRun === null ? '—' : usd(perRun)}>
          {count(s.last7.tokens_in)} in · {count(s.last7.tokens_out)} out tokens
          {s.last7.estimated > 0 && <Warn> · {s.last7.estimated} estimated</Warn>}
        </Stat>
      </div>

      {s.last30.calls === 0 ? (
        <Card>
          <EmptyState>
            <h2 className="mb-1.5 text-base font-semibold text-fg">No LLM calls in the last 30 days</h2>
            Runs of any workflow with a model node show up here within a minute, priced per call.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Section title="Spend per day, last 14 days">
            <Card className="overflow-visible p-4 pb-2">
              <DailyCostChart days={days} />
            </Card>
          </Section>

          <Section title="Workflows, last 7 days">
            <Card>
              {workflows.length === 0 ? (
                NO_CALLS
              ) : (
                <Table>
                  <thead>
                    <TableRow>
                      <TableHead>Workflow</TableHead>
                      <TableHead numeric>Runs</TableHead>
                      <TableHead numeric>Calls</TableHead>
                      <TableHead numeric className="max-md:hidden">
                        Tokens in / out
                      </TableHead>
                      <TableHead numeric>Per run</TableHead>
                      <TableHead numeric>Total</TableHead>
                    </TableRow>
                  </thead>
                  <tbody>
                    {workflows.map((w) => (
                      <TableRow key={w.workflow_id}>
                        <TableCell className="font-semibold">{w.workflow_name || w.workflow_id}</TableCell>
                        <TableCell numeric>{count(w.runs)}</TableCell>
                        <TableCell numeric>{count(w.calls)}</TableCell>
                        <TableCell numeric className="max-md:hidden">
                          {count(w.tokens_in)} / {count(w.tokens_out)}
                        </TableCell>
                        <TableCell numeric>{usd(w.per_run)}</TableCell>
                        <TableCell numeric>
                          {usd(w.cost)}
                          {w.unpriced > 0 && (
                            <div className="font-sans text-xs">
                              <Warn>{w.unpriced} without price</Warn>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </Section>

          <Section title="Models and prices, last 7 days">
            <Card>
              {models.length === 0 ? (
                NO_CALLS
              ) : (
                <Table>
                  <thead>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead numeric>Calls</TableHead>
                      <TableHead numeric className="max-md:hidden">
                        Tokens in / out
                      </TableHead>
                      <TableHead numeric>Price in / out per 1M</TableHead>
                      <TableHead numeric>Total</TableHead>
                    </TableRow>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <TableRow key={`${m.provider}/${m.model}`}>
                        <TableCell>
                          <span className="font-semibold">{m.model}</span>{' '}
                          <span className="text-muted">{m.provider}</span>
                        </TableCell>
                        <TableCell numeric>{count(m.calls)}</TableCell>
                        <TableCell numeric className="max-md:hidden">
                          {count(m.tokens_in)} / {count(m.tokens_out)}
                        </TableCell>
                        <TableCell numeric>
                          {m.input_per_mtok === null ? (
                            <Warn>no price</Warn>
                          ) : (
                            <>
                              {perMtok(m.input_per_mtok)} / {perMtok(m.output_per_mtok)}
                              <div className="font-sans text-xs text-muted">
                                {m.price_tiers > 1 && 'base tier · '}since {m.valid_from}
                                {m.source_url && (
                                  <>
                                    {' · '}
                                    <a href={m.source_url} target="_blank" rel="noreferrer" className="underline">
                                      source
                                    </a>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell numeric>{usd(m.cost)}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </Section>

          <Section title="Most expensive runs, last 7 days">
            <Card>
              {runs.length === 0 ? (
                NO_CALLS
              ) : (
                <Table>
                  <thead>
                    <TableRow>
                      <TableHead>Execution</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead numeric>Calls</TableHead>
                      <TableHead numeric className="max-md:hidden">
                        Tokens in / out
                      </TableHead>
                      <TableHead numeric>Cost</TableHead>
                    </TableRow>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const url = executionUrl(r.workflow_id, r.execution_id);
                      return (
                        <TableRow key={r.execution_id} data-testid="expensive-run">
                          <TableCell className="font-mono whitespace-nowrap text-muted">
                            {url ? <ExternalLink href={url}>{r.execution_id}</ExternalLink> : r.execution_id}
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold">{r.workflow_name}</span>
                            {r.status && r.status !== 'success' && (
                              <span className="text-xs">
                                {' '}
                                · <Warn>{r.status}</Warn>
                              </span>
                            )}
                            <div className="mt-0.5 font-mono text-xs text-muted">{r.models}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted" title={exact(r.started_at)}>
                            {ago(r.started_at)}
                          </TableCell>
                          <TableCell numeric>{r.calls}</TableCell>
                          <TableCell numeric className="max-md:hidden">
                            {count(r.tokens_in)} / {count(r.tokens_out)}
                          </TableCell>
                          <TableCell numeric>{usd(r.cost)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </Section>
        </>
      )}
    </main>
  );
}
