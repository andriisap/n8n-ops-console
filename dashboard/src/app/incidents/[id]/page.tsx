import Link from 'next/link';
import { notFound } from 'next/navigation';
import { changeStatus } from '@/app/actions';
import { ClassLabel, StatusBadge } from '@/components/Badges';
import { ago, exact } from '@/lib/format';
import { getIncident, listEvents, type Status } from '@/lib/incidents';

export const dynamic = 'force-dynamic';

function StatusButton({ id, to, label, primary }: { id: number; to: Status; label: string; primary?: boolean }) {
  return (
    <form action={changeStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <button type="submit" className={primary ? 'btn primary' : 'btn'}>{label}</button>
    </form>
  );
}

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const incident = await getIncident(id);
  if (!incident) notFound();
  const events = await listEvents(id);

  return (
    <main>
      <Link href="/" className="back">← All incidents</Link>

      <div className="head">
        <div>
          <h2>
            #{incident.id} {incident.workflow_name}
            {incident.node_name && <span className="node"> → {incident.node_name}</span>}
          </h2>
          <div className="sub">
            <StatusBadge status={incident.status} />
            <ClassLabel value={incident.error_class} />
            {incident.reopened_count > 0 && <span>reopened {incident.reopened_count}×</span>}
          </div>
        </div>
        <div className="actions">
          {incident.status === 'open' && (
            <>
              <StatusButton id={id} to="resolved" label="Resolve" primary />
              <StatusButton id={id} to="ignored" label="Ignore" />
            </>
          )}
          {incident.status !== 'open' && <StatusButton id={id} to="open" label="Reopen" />}
        </div>
      </div>

      <section className="stats">
        <div className="stat"><div className="k">Occurrences</div><div className="v">{incident.occurrences}</div></div>
        <div className="stat"><div className="k">First seen</div><div className="v small" title={exact(incident.first_seen_at)}>{ago(incident.first_seen_at)}</div></div>
        <div className="stat"><div className="k">Last seen</div><div className="v small" title={exact(incident.last_seen_at)}>{ago(incident.last_seen_at)}</div></div>
        <div className="stat"><div className="k">Last alert</div><div className="v small" title={exact(incident.last_alerted_at)}>{ago(incident.last_alerted_at)}</div></div>
      </section>

      <h3>Normalized message</h3>
      <div className="message">{incident.error_message}</div>

      <h3>Recent events <span className="node">({events.length}{events.length === 50 ? '+' : ''})</span></h3>
      <div className="card">
        {events.length === 0 ? (
          <div className="empty">No events recorded.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Execution</th>
                <th>When</th>
                <th className="hide-sm">Mode</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="id">
                    {e.execution_url
                      ? <a href={e.execution_url} target="_blank" rel="noreferrer">{e.execution_id} ↗</a>
                      : e.execution_id}
                  </td>
                  <td className="when" title={exact(e.occurred_at)}>{ago(e.occurred_at)}</td>
                  <td className="hide-sm node">{e.execution_mode ?? '—'}</td>
                  <td>
                    <div className="msg" title={e.error_message}>{e.error_message}</div>
                    {e.error_raw && (
                      <details>
                        <summary>raw error</summary>
                        <pre>{JSON.stringify(e.error_raw, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
