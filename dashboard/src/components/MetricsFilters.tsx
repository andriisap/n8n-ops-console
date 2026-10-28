'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { filterQuery, PERIODS, type MetricsFilter, type WorkflowOption } from '@/lib/metrics';

// Period, workflow and test-workflow switch. All of it lives in the URL, so any view can
// be linked; the select navigates on change, the rest are plain links.
export default function MetricsFilters({ f, workflows, base = '/metrics' }: {
  f: MetricsFilter; workflows: WorkflowOption[]; base?: string;
}) {
  const router = useRouter();
  const shown = workflows.filter((w) => !f.hideTest || !w.test || w.workflow_id === f.workflow);

  return (
    <div className="filters">
      <nav className="tabs" aria-label="Period">
        {PERIODS.map((d) => (
          <Link key={d} className="tab" href={base + filterQuery(f, { days: d })} aria-current={f.days === d ? 'page' : undefined}>
            {d} days
          </Link>
        ))}
      </nav>
      <select
          className="select"
          aria-label="Workflow"
          value={f.workflow ?? ''}
          onChange={(e) => router.push(base + filterQuery(f, { workflow: e.target.value || null }))}
        >
          <option value="">All workflows</option>
          {shown.map((w) => <option key={w.workflow_id} value={w.workflow_id}>{w.workflow_name}</option>)}
      </select>
      <Link className="toggle" href={base + filterQuery(f, { hideTest: !f.hideTest })} role="switch" aria-checked={!f.hideTest}>
        <span aria-hidden="true">{f.hideTest ? '☐' : '☑'}</span> Include test workflows (chaos-*)
      </Link>
    </div>
  );
}
