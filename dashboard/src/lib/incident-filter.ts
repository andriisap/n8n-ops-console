// Incident filter types and URL helpers. No database import: client components use this.

export const STATUSES = ['open', 'resolved', 'ignored'] as const;
export type Status = (typeof STATUSES)[number];

export const ERROR_CLASSES = ['rate_limit', 'transient', 'auth', 'validation', 'unknown'] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

// Filters for the incident list, all from the URL. Unknown values fall back, never throw.
export const SEEN_WITHIN = [1, 7, 30] as const;

export type IncidentFilter = {
  status: Status | 'all';
  workflow: string | null; // workflow_id
  errorClass: ErrorClass | null;
  days: number | null; // last seen within N days; null = any time
  q: string | null; // text in workflow, node or message
};

export type IncidentSearch = { status?: string; wf?: string; class?: string; days?: string; q?: string };

export function parseIncidentFilter(sp: IncidentSearch): IncidentFilter {
  const days = Number(sp.days);
  const q = sp.q?.trim().slice(0, 100);
  return {
    status: sp.status === 'all' ? 'all' : isStatus(sp.status) ? sp.status : 'open',
    workflow: sp.wf && sp.wf.length <= 64 ? sp.wf : null,
    errorClass: (ERROR_CLASSES as readonly string[]).includes(sp.class ?? '') ? (sp.class as ErrorClass) : null,
    days: (SEEN_WITHIN as readonly number[]).includes(days) ? days : null,
    q: q ? q : null,
  };
}

// Filter -> query string, defaults left out. `patch` changes one thing for a link.
export function incidentQuery(f: IncidentFilter, patch: Partial<IncidentFilter> = {}): string {
  const g = { ...f, ...patch };
  const p = new URLSearchParams();
  if (g.status !== 'open') p.set('status', g.status);
  if (g.workflow) p.set('wf', g.workflow);
  if (g.errorClass) p.set('class', g.errorClass);
  if (g.days) p.set('days', String(g.days));
  if (g.q) p.set('q', g.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const isFiltered = (f: IncidentFilter) => !!(f.workflow || f.errorClass || f.days || f.q);
