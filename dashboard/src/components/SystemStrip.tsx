import { ago, exact } from '@/lib/format';
import { systemStatus, type CheckState } from '@/lib/system';
import { cn } from '@/lib/utils';

// One line under the header: is everything that watches n8n alive?
// State is carried by an icon and a word as well as colour.
const SHORT: Record<string, string> = {
  'n8n-heartbeat': 'n8n schedules',
  'error-handler': 'Alert pipeline',
  'n8n-http': 'n8n web',
  'dashboard-http': 'Dashboard',
};
const MARK: Record<CheckState, string> = { up: '●', down: '▲', unknown: '○' };
const TONE: Record<CheckState, string> = { up: 'text-resolved', down: 'text-open', unknown: 'text-muted' };

export default async function SystemStrip() {
  const s = await systemStatus();
  const collector = s.beats.find((b) => b.source === 'ops-cost-collector');

  return (
    <div
      className="-mt-3 mb-5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[10px] border border-border bg-surface px-3 py-2 text-xs"
      aria-label="System status"
    >
      {s.watchdog === null ? (
        <span className="whitespace-nowrap text-muted">Watchdog not configured</span>
      ) : !s.watchdog.reachable ? (
        <span className="whitespace-nowrap text-open" title={s.watchdog.reason}>
          ▲ Watchdog unreachable
        </span>
      ) : (
        <>
          <span className="font-semibold text-muted">Watchdog</span>
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
              <span key={c.name} className={cn('whitespace-nowrap', TONE[c.state])} title={title}>
                {MARK[c.state]} {SHORT[c.name] ?? c.label}
                {c.state === 'down' ? (
                  <b className="font-semibold"> down</b>
                ) : c.last_ping_at ? (
                  <span className="text-muted"> {ago(c.last_ping_at)}</span>
                ) : null}
              </span>
            );
          })}
        </>
      )}
      {collector && (
        <span
          className="whitespace-nowrap text-muted"
          title={`ops-cost-collector heartbeat ${exact(collector.last_beat_at)}`}
        >
          Cost collector {ago(collector.last_beat_at)}
        </span>
      )}
    </div>
  );
}
