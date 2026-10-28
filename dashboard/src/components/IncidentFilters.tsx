'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ALL, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ERROR_CLASSES,
  incidentQuery,
  isFiltered,
  SEEN_WITHIN,
  type ErrorClass,
  type IncidentFilter,
} from '@/lib/incident-filter';
import type { WorkflowChoice } from '@/lib/incidents';

// Workflow, class, period and text search above the incident list. Everything is in the
// URL: a filtered view can be bookmarked or sent. Selects apply at once, search on Enter.
export default function IncidentFilters({ f, workflows }: { f: IncidentFilter; workflows: WorkflowChoice[] }) {
  const router = useRouter();
  const [q, setQ] = useState(f.q ?? '');
  const go = (patch: Partial<IncidentFilter>) => router.push('/' + incidentQuery(f, patch));
  const orNull = (v: string) => (v === ALL ? null : v);

  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: q.trim() || null });
      }}
    >
      <Select value={f.workflow ?? ALL} onValueChange={(v) => go({ workflow: orNull(v) })}>
        <SelectTrigger aria-label="Workflow" className="max-sm:flex-1 sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All workflows</SelectItem>
          {workflows.map((w) => (
            <SelectItem key={w.workflow_id} value={w.workflow_id}>
              {w.workflow_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={f.errorClass ?? ALL} onValueChange={(v) => go({ errorClass: orNull(v) as ErrorClass | null })}>
        <SelectTrigger aria-label="Error class" className="max-sm:flex-1 sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All classes</SelectItem>
          {ERROR_CLASSES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={f.days ? String(f.days) : ALL} onValueChange={(v) => go({ days: v === ALL ? null : Number(v) })}>
        <SelectTrigger aria-label="Last seen" className="max-sm:w-full sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any time</SelectItem>
          {SEEN_WITHIN.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {d === 1 ? 'Last 24 hours' : `Last ${d} days`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          className="w-full rounded-lg border border-border bg-surface py-1.5 pr-2.5 pl-8 text-sm text-fg placeholder:text-muted"
          type="search"
          placeholder="Search workflow, node, message"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
        />
      </label>
      {isFiltered(f) && (
        <Link
          className="text-[13px] text-muted"
          href={'/' + incidentQuery({ ...f, workflow: null, errorClass: null, days: null, q: null })}
        >
          Clear filters
        </Link>
      )}
    </form>
  );
}
