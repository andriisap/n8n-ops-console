import { ago, exact } from '@/lib/format';
import { systemStatus, type CheckState } from '@/lib/system';

// One line under the header: is everything that watches n8n alive?
// State is carried by an icon and a word as well as colour.
const SHORT: Record<string, string> = {
  'n8n-heartbeat': 'n8n schedules',
  'error-handler': 'Alert pipeline',
  'n8n-http': 'n8n web',
  'dashboard-http': 'Dashboard',
};
const MARK: Record<CheckState, string> = { up: '●', down: '▲', unknown: '○' };

export default async function SystemStrip() {
  const s = await systemStatus();
  const collector = s.beats.find((b) => b.source === 'ops-cost-collector');

  return (
    <div className="strip" aria-label="System status">
      {s.watchdog === null ? (
        <span className="strip-item muted">Watchdog not configured</span>
      ) : !s.watchdog.reachable ? (
        <span className="strip-item st-down" title={s.watchdog.reason}>
          ▲ Watchdog unreachable
        </span>
      ) : (
        <>
          <span className="strip-label">Watchdog</span>
          {s.watchdog.checks.map((c) => {
            const when = c.last_ping_at ?? c.since;
            const title = [
              c.label,
              c.state,
              c.detail,
              when ? `${c.last_ping_at ? 'last signal' : 'since'} ${exact(when)}` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <span key={c.name} className={`strip-item st-${c.state}`} title={title}>
                {MARK[c.state]} {SHORT[c.name] ?? c.label}
                {c.state === 'down' ? (
                  <b> down</b>
                ) : c.last_ping_at ? (
                  <span className="muted"> {ago(c.last_ping_at)}</span>
                ) : null}
              </span>
            );
          })}
        </>
      )}
      {collector && (
        <span className="strip-item muted" title={`ops-cost-collector heartbeat ${exact(collector.last_beat_at)}`}>
          Cost collector {ago(collector.last_beat_at)}
        </span>
      )}
    </div>
  );
}
