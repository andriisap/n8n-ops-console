import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { changeStatus } from '@/app/actions';
import { ClassLabel, StatusBadge } from '@/components/Badges';
import { ExternalLink } from '@/components/ExternalLink';
import RetryCell from '@/components/RetryCell';
import { SubmitButton } from '@/components/SubmitButton';
import { Card, EmptyState, Section, Stat } from '@/components/ui/card';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { ago, exact } from '@/lib/format';
import { getIncident, listEvents, type Status } from '@/lib/incidents';

export const dynamic = 'force-dynamic';

const EVENTS = 50;

function StatusButton({ id, to, label, primary }: { id: number; to: Status; label: string; primary?: boolean }) {
  return (
    <form action={changeStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <SubmitButton variant={primary ? 'primary' : 'default'}>{label}</SubmitButton>
    </form>
  );
}

const When = ({ at }: { at: Date | null }) => (
  <span className="font-sans text-sm font-medium" title={exact(at)}>
    {ago(at)}
  </span>
);

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const incident = await getIncident(id);
  if (!incident) notFound();
  const events = await listEvents(id, EVENTS);

  return (
    <main>
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-muted">
        <ArrowLeft className="size-4" aria-hidden /> All incidents
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-xl font-semibold tracking-tight">
            #{incident.id} {incident.workflow_name}
            {incident.node_name && <span className="text-muted"> → {incident.node_name}</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2.5 text-muted">
            <StatusBadge status={incident.status} />
            <ClassLabel value={incident.error_class} />
            {incident.reopened_count > 0 && <span>reopened {incident.reopened_count}×</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {incident.status === 'open' && (
            <>
              <StatusButton id={id} to="resolved" label="Resolve" primary />
              <StatusButton id={id} to="ignored" label="Ignore" />
            </>
          )}
          {incident.status !== 'open' && <StatusButton id={id} to="open" label="Reopen" />}
        </div>
      </div>

      <section className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="Occurrences" value={incident.occurrences} />
        <Stat label="First seen" value={<When at={incident.first_seen_at} />} />
        <Stat label="Last seen" value={<When at={incident.last_seen_at} />} />
        <Stat label="Last alert" value={<When at={incident.last_alerted_at} />} />
      </section>

      <Section title="Normalized message">
        <div className="rounded-xl border border-border bg-surface px-3.5 py-3 font-mono text-[13px] break-words whitespace-pre-wrap">
          {incident.error_message}
        </div>
      </Section>

      <Section
        title={
          <>
            Recent events{' '}
            <span className="font-normal text-muted">
              ({events.length}
              {events.length === EVENTS ? '+' : ''})
            </span>
          </>
        }
      >
        <Card>
          {events.length === 0 ? (
            <EmptyState>No events recorded.</EmptyState>
          ) : (
            <Table>
              <thead>
                <TableRow>
                  <TableHead>Execution</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="max-md:hidden">Mode</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Retry</TableHead>
                </TableRow>
              </thead>
              <tbody>
                {events.map((e) => (
                  <TableRow key={e.id} data-testid="event-row">
                    <TableCell className="font-mono whitespace-nowrap text-muted">
                      {e.execution_url ? (
                        <ExternalLink href={e.execution_url}>{e.execution_id}</ExternalLink>
                      ) : (
                        e.execution_id
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted" title={exact(e.occurred_at)}>
                      {ago(e.occurred_at)}
                    </TableCell>
                    <TableCell className="text-muted max-md:hidden">{e.execution_mode ?? '—'}</TableCell>
                    <TableCell>
                      <div
                        className="max-w-[220px] truncate font-mono text-xs text-muted md:max-w-[520px]"
                        title={e.error_message}
                      >
                        {e.error_message}
                      </div>
                      {e.error_raw && (
                        <details>
                          <summary>raw error</summary>
                          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-xs break-words whitespace-pre-wrap">
                            {JSON.stringify(e.error_raw, null, 2)}
                          </pre>
                        </details>
                      )}
                    </TableCell>
                    <TableCell>
                      <RetryCell event={e} incidentId={id} />
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </Section>
    </main>
  );
}
