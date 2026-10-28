import { replayEvent } from '@/app/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { ago, exact, usd } from '@/lib/format';
import type { ErrorEvent } from '@/lib/incidents';
import { cn } from '@/lib/utils';

function ReplayButton({ event, incidentId }: { event: ErrorEvent; incidentId: number }) {
  return (
    <form action={replayEvent} className="inline">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="incidentId" value={incidentId} />
      <SubmitButton size="sm" title="Run this execution again with the latest saved workflow">
        Replay
      </SubmitButton>
    </form>
  );
}

const Note = ({
  tone,
  className,
  ...props
}: React.ComponentProps<'span'> & { tone: 'muted' | 'ok' | 'wait' | 'bad' }) => (
  <span
    className={cn(
      'text-xs whitespace-nowrap',
      { muted: 'text-muted', ok: 'text-resolved', wait: 'text-cls-transient', bad: 'text-open' }[tone],
      className,
    )}
    {...props}
  />
);

// What happened to the retries of one failed execution, and whether it can be replayed now.
export default function RetryCell({ event: e, incidentId }: { event: ErrorEvent; incidentId: number }) {
  if (e.retry_of) {
    return <Note tone="muted">this was a retry of {e.retry_of}</Note>;
  }
  if (e.recovered) {
    return (
      <Note tone="ok" data-testid="recovered">
        ✓ {e.recovered_kind === 'manual' ? 'replay succeeded' : 'recovered'}
        {e.recovered_execution_id ? ` (${e.recovered_execution_id})` : ''}
        {e.recovered_calls ? (
          <span className="font-mono text-fg" title="LLM calls of the run that succeeded, priced like /costs">
            {' '}
            · {e.recovered_cost === null ? 'no price' : usd(e.recovered_cost)} for {e.recovered_calls} LLM call
            {e.recovered_calls > 1 ? 's' : ''}
            {e.recovered_unpriced ? `, ${e.recovered_unpriced} without price` : ''}
          </span>
        ) : null}
      </Note>
    );
  }
  if (e.execution_id.startsWith('trigger:')) {
    return <Note tone="muted">trigger failure, nothing to retry</Note>;
  }

  switch (e.retry_status) {
    case 'pending':
      return (
        <Note tone="wait" title={exact(e.retry_next_at)}>
          {e.retry_kind === 'manual'
            ? 'replay queued'
            : `retry ${(e.retry_attempt ?? 0) + 1}/${e.retry_max} ${
                e.retry_next_at && !e.retry_due ? ago(e.retry_next_at) : 'due now'
              }`}
        </Note>
      );
    case 'in_progress':
      return <Note tone="wait">retrying now…</Note>;
    case 'dead':
      return (
        <span className="inline-flex items-center gap-2">
          <Note tone="bad" title={e.retry_last_error ?? ''}>
            {e.retry_kind === 'manual' ? 'replay failed' : `gave up after ${e.retry_attempt}`}
          </Note>
          <ReplayButton event={e} incidentId={incidentId} />
        </span>
      );
    default:
      // not retried automatically (auth, validation, unknown): a human decides
      return <ReplayButton event={e} incidentId={incidentId} />;
  }
}
