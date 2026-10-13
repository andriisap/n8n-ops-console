import type { ErrorClass, Status } from '@/lib/incidents';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}

export function ClassLabel({ value }: { value: ErrorClass }) {
  return <span className={`class class-${value}`}>{value}</span>;
}
