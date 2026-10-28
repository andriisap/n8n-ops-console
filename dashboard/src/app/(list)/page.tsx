import Link from 'next/link';
import { ClassLabel, StatusBadge } from '@/components/Badges';
import IncidentFilters from '@/components/IncidentFilters';
import { Card, EmptyState } from '@/components/ui/card';
import { LinkTab, LinkTabs } from '@/components/ui/link-tabs';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { ago, exact } from '@/lib/format';
import {
  countByStatus,
  incidentQuery,
  isFiltered,
  listIncidents,
  parseIncidentFilter,
  STATUSES,
  workflowChoices,
  type IncidentSearch,
  type Status,
} from '@/lib/incidents';

export const dynamic = 'force-dynamic';

type Filter = Status | 'all';

const LIMIT = 200;

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<IncidentSearch> }) {
  const f = parseIncidentFilter(await searchParams);
  const filter: Filter = f.status;

  const [incidents, counts, workflows] = await Promise.all([listIncidents(f), countByStatus(f), workflowChoices()]);
  const total = counts.open + counts.resolved + counts.ignored;
  const tabs: { key: Filter; label: string; n: number }[] = [
    ...STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), n: counts[s] })),
    { key: 'all', label: 'All', n: total },
  ];
  const cleared = '/' + incidentQuery(f, { workflow: null, errorClass: null, days: null, q: null });

  return (
    <main>
      <LinkTabs label="Filter by status" className="mb-4">
        {tabs.map((t) => (
          <LinkTab key={t.key} href={'/' + incidentQuery(f, { status: t.key })} active={filter === t.key} count={t.n}>
            {t.label}
          </LinkTab>
        ))}
      </LinkTabs>

      <IncidentFilters key={incidentQuery(f)} f={f} workflows={workflows} />

      <Card>
        {incidents.length === 0 ? (
          <EmptyState>
            {isFiltered(f) ? (
              <>
                No {filter === 'all' ? '' : `${filter} `}incidents match these filters.{' '}
                <Link href={cleared}>Clear filters</Link>
              </>
            ) : filter === 'open' ? (
              'No open incidents. Everything is running.'
            ) : filter === 'all' ? (
              'No incidents yet. Failures of any workflow that uses ops-error-handler land here.'
            ) : (
              `No ${filter} incidents.`
            )}
          </EmptyState>
        ) : (
          <Table fit>
            <thead>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Workflow · node</TableHead>
                <TableHead className="max-md:hidden">Class</TableHead>
                <TableHead numeric className="max-md:hidden">
                  Count
                </TableHead>
                <TableHead className="max-md:hidden">Last seen</TableHead>
                <TableHead className="max-md:hidden">First seen</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <TableRow key={i.id} data-testid="incident-row">
                  <TableCell className="font-mono whitespace-nowrap text-muted">
                    <Link href={`/incidents/${i.id}`}>{i.id}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/incidents/${i.id}`} className="font-semibold">
                      {i.workflow_name}
                    </Link>
                    {i.node_name && <span className="text-muted"> → {i.node_name}</span>}
                    <div
                      className="mt-0.5 max-w-[220px] truncate font-mono text-xs text-muted md:max-w-[520px]"
                      title={i.error_message}
                    >
                      {i.error_message}
                    </div>
                    <div className="mt-1 text-xs text-muted md:hidden">
                      <ClassLabel value={i.error_class} /> · {i.occurrences}× · {ago(i.last_seen_at)}
                    </div>
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    <ClassLabel value={i.error_class} />
                  </TableCell>
                  <TableCell numeric className="max-md:hidden">
                    {i.occurrences}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted max-md:hidden" title={exact(i.last_seen_at)}>
                    {ago(i.last_seen_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted max-md:hidden" title={exact(i.first_seen_at)}>
                    {ago(i.first_seen_at)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
        {incidents.length === LIMIT && (
          <p className="px-3.5 py-2 text-xs text-muted">
            Showing the {LIMIT} most recent. Narrow the filters to see older ones.
          </p>
        )}
      </Card>
    </main>
  );
}
