import Link from 'next/link';
import { ClassLabel, StatusBadge } from '@/components/Badges';
import { ago, exact } from '@/lib/format';
import { countByStatus, isStatus, listIncidents, STATUSES, type Status } from '@/lib/incidents';

export const dynamic = 'force-dynamic';

type Filter = Status | 'all';

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: raw } = await searchParams;
  const filter: Filter = raw === 'all' ? 'all' : isStatus(raw) ? raw : 'open';

  const [incidents, counts] = await Promise.all([listIncidents(filter), countByStatus()]);
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
            href={t.key === 'open' ? '/' : `/?status=${t.key}`}
            className="tab"
            aria-current={filter === t.key ? 'page' : undefined}
          >
            {t.label}<span className="n">{t.n}</span>
          </Link>
        ))}
      </nav>

      <div className="card">
        {incidents.length === 0 ? (
          <div className="empty">
            {filter === 'open' ? 'No open incidents. Everything is running.' : 'Nothing here.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Workflow · node</th>
                <th>Class</th>
                <th className="num">Count</th>
                <th>Last seen</th>
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
                  </td>
                  <td><ClassLabel value={i.error_class} /></td>
                  <td className="num">{i.occurrences}</td>
                  <td className="when" title={exact(i.last_seen_at)}>{ago(i.last_seen_at)}</td>
                  <td className="when hide-sm" title={exact(i.first_seen_at)}>{ago(i.first_seen_at)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
