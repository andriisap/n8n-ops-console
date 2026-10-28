'use client';

import { Check, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LinkTab, LinkTabs } from '@/components/ui/link-tabs';
import { ALL, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { filterQuery, PERIODS, type MetricsFilter, type WorkflowOption } from '@/lib/metrics';

// Period, workflow and test-workflow switch. All of it lives in the URL, so any view can
// be linked; the select navigates on change, the rest are plain links.
export default function MetricsFilters({
  f,
  workflows,
  base = '/metrics',
}: {
  f: MetricsFilter;
  workflows: WorkflowOption[];
  base?: string;
}) {
  const router = useRouter();
  const shown = workflows.filter((w) => !f.hideTest || !w.test || w.workflow_id === f.workflow);
  const Box = f.hideTest ? Square : Check;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <LinkTabs label="Period">
        {PERIODS.map((d) => (
          <LinkTab key={d} href={base + filterQuery(f, { days: d })} active={f.days === d}>
            {d} days
          </LinkTab>
        ))}
      </LinkTabs>
      <Select
        value={f.workflow ?? ALL}
        onValueChange={(v) => router.push(base + filterQuery(f, { workflow: v === ALL ? null : v }))}
      >
        <SelectTrigger aria-label="Workflow" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All workflows</SelectItem>
          {shown.map((w) => (
            <SelectItem key={w.workflow_id} value={w.workflow_id}>
              {w.workflow_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg hover:no-underline"
        href={base + filterQuery(f, { hideTest: !f.hideTest })}
        role="switch"
        aria-checked={!f.hideTest}
      >
        <Box className="size-3.5 rounded-sm border border-current" aria-hidden />
        Include test workflows (chaos-*)
      </Link>
    </div>
  );
}
