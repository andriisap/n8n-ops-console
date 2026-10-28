import Link from 'next/link';
import { ClassLabel, StatusBadge } from '@/components/Badges';
import { ago, exact } from '@/lib/format';
import IncidentFilters from '@/components/IncidentFilters';
import {
  countByStatus, incidentQuery, isFiltered, listIncidents, parseIncidentFilter, STATUSES, workflowChoices,
  type IncidentSearch, type Status,
} from '@/lib/incidents';

export const dynamic = 'force-dynamic';

type Filter = Status | 'all';

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<IncidentSearch>;
}) {
  const f = parseIncidentFilter(await searchParams);
  const filter: Filter = f.status;

  const [incidents, counts, workflows] = await Promise.all([listIncidents(f), countByStatus(f), workflowChoices()]);
  const total = counts.open + counts.resolved + counts.ignored;
  const tabs: { key: Filter; label: string; n: number }[] = [
    ...STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), n: counts[s] })),
    { key: 'all', label: 'All', n: total },
  ];

  return (
    <main>
      <nav className="tabs" aria-label="Filter by status">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={'/' + incidentQuery(f, { status: t.key })}
            className="tab"
            aria-current={filter === t.key ? 'page' : undefined}
          >
            {t.label}<span className="n">{t.n}</span>
          </Link>
        ))}
      </nav>

      <IncidentFilters key={incidentQuery(f)} f={f} workflows={workflows} />

      <div className="card">
        {incidents.length === 0 ? (
          <div className="empty">
            {isFiltered(f)
              ? <>No {filter === 'all' ? '' : `${filter} `}incidents match these filters.{' '}
                  <Link href={'/' + incidentQuery(f, { workflow: null, errorClass: null, days: null, q: null })}>Clear filters</Link></>
              : filter === 'open' ? 'No open incidents. Everything is running.'
              : filter === 'all' ? 'No incidents yet. Failures of any workflow that uses ops-error-handler land here.'
              : `No ${filter} incidents.`}
          </div>
        ) : (
          <div className="table-wrap"><table className="table fit">
            <thead>
              <tr>
                <th>#</th>
                <th>Workflow · node</th>
                <th className="hide-sm">Class</th>
                <th className="num hide-sm">Count</th>
                <th className="hide-sm">Last seen</th>
                <th className="hide-sm">First seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td className="id">
                    <Link href={`/incidents/${i.id}`}>{i.id}</Link>
                  </td>
                  <td>
                    <Link href={`/incidents/${i.id}`} className="wf">{i.workflow_name}</Link>
                    {i.node_name && <span className="node"> → {i.node_name}</span>}
                    <div className="msg" title={i.error_message}>{i.error_message}</div>
                    <div className="show-sm small muted">
                      <ClassLabel value={i.error_class} /> · {i.occurrences}× · {ago(i.last_seen_at)}
                    </div>
                  </td>
                  <td className="hide-sm"><ClassLabel value={i.error_class} /></td>
                  <td className="num hide-sm">{i.occurrences}</td>
                  <td className="when hide-sm" title={exact(i.last_seen_at)}>{ago(i.last_seen_at)}</td>
                  <td className="when hide-sm" title={exact(i.first_seen_at)}>{ago(i.first_seen_at)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {incidents.length === 200 && <div className="note" style={{ padding: '8px 14px' }}>Showing the 200 most recent. Narrow the filters to see older ones.</div>}
      </div>
    </main>
  );
}
