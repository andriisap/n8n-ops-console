'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { WorkflowChoice } from '@/lib/incidents';
import {
  ERROR_CLASSES, incidentQuery, isFiltered, SEEN_WITHIN,
  type ErrorClass, type IncidentFilter,
} from '@/lib/incident-filter';

// Workflow, class, period and text search above the incident list. Everything is in the
// URL: a filtered view can be bookmarked or sent. Selects apply at once, search on Enter.
export default function IncidentFilters({ f, workflows }: { f: IncidentFilter; workflows: WorkflowChoice[] }) {
  const router = useRouter();
  const [q, setQ] = useState(f.q ?? '');
  const go = (patch: Partial<IncidentFilter>) => router.push('/' + incidentQuery(f, patch));

  return (
    <form
      className="filters"
      role="search"
      onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null }); }}
    >
      <select className="select" aria-label="Workflow" value={f.workflow ?? ''}
        onChange={(e) => go({ workflow: e.target.value || null })}>
        <option value="">All workflows</option>
        {workflows.map((w) => <option key={w.workflow_id} value={w.workflow_id}>{w.workflow_name}</option>)}
      </select>
      <select className="select" aria-label="Error class" value={f.errorClass ?? ''}
        onChange={(e) => go({ errorClass: (e.target.value || null) as ErrorClass | null })}>
        <option value="">All classes</option>
        {ERROR_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select className="select" aria-label="Last seen" value={f.days ?? ''}
        onChange={(e) => go({ days: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Any time</option>
        {SEEN_WITHIN.map((d) => <option key={d} value={d}>{d === 1 ? 'Last 24 hours' : `Last ${d} days`}</option>)}
      </select>
      <input className="select search" type="search" placeholder="Search workflow, node, message"
        aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
      {isFiltered(f) && <Link className="toggle" href={'/' + incidentQuery({ ...f, workflow: null, errorClass: null, days: null, q: null })}>Clear filters</Link>}
    </form>
  );
}
