import { replayEvent } from '@/app/actions';
import { ago, exact } from '@/lib/format';
import type { ErrorEvent } from '@/lib/incidents';

function ReplayButton({ event, incidentId }: { event: ErrorEvent; incidentId: number }) {
  return (
    <form action={replayEvent} className="inline">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <button type="submit" className="btn sm" title="Run this execution again with the latest saved workflow">
        Replay
      </button>
    </form>
  );
}

// What happened to the retries of one failed execution, and whether it can be replayed now.
export default function RetryCell({ event: e, incidentId }: { event: ErrorEvent; incidentId: number }) {
  if (e.retry_of) {
    return <span className="retry muted">this was a retry of {e.retry_of}</span>;
  }
  if (e.recovered) {
    return (
      <span className="retry ok">
        ✓ recovered{e.retry_execution_id ? ` (${e.retry_execution_id})` : ''}
      </span>
    );
  }
  if (e.execution_id.startsWith('trigger:')) {
    return <span className="retry muted">trigger failure, nothing to retry</span>;
  }

  switch (e.retry_status) {
    case 'pending':
      return (
        <span className="retry wait" title={exact(e.retry_next_at)}>
          {e.retry_kind === 'manual'
            ? 'replay queued'
            : `retry ${(e.retry_attempt ?? 0) + 1}/${e.retry_max} ${
                e.retry_next_at && new Date(e.retry_next_at).getTime() > Date.now()
                  ? ago(e.retry_next_at)
                  : 'due now'
              }`}
        </span>
      );
    case 'in_progress':
      return <span className="retry wait">retrying now…</span>;
    case 'dead':
      return (
        <span className="retry-row">
          <span className="retry bad" title={e.retry_last_error ?? ''}>
            {e.retry_kind === 'manual' ? 'replay failed' : `gave up after ${e.retry_attempt}`}
          </span>
          <ReplayButton event={e} incidentId={incidentId} />
        </span>
      );
    default:
      // not retried automatically (auth, validation, unknown): a human decides
      return <ReplayButton event={e} incidentId={incidentId} />;
  }
}
