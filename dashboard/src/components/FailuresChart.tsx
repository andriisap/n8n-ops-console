import { BarChart, ChartTable, dayLabel } from '@/components/charts/BarChart';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { CLASS_FILL, CLASS_ORDER } from '@/lib/error-classes';
import type { ErrorClass } from '@/lib/incident-filter';
import type { DayFailures } from '@/lib/metrics';
import { cn } from '@/lib/utils';

function Swatch({ c }: { c: ErrorClass }) {
  return <span className={cn('mr-1.5 inline-block size-2.5 rounded-[3px] align-[-1px]', CLASS_FILL[c])} aria-hidden />;
}

// Failures per UTC day, stacked by error class. Legend always shown (several series);
// exact numbers in a tooltip per day and in the table under the chart.
export default function FailuresChart({ days }: { days: DayFailures[] }) {
  const max = Math.max(...days.map((d) => d.total), 0);
  const present = CLASS_ORDER.filter((c) => days.some((d) => d.by_class[c]));

  return (
    <figure className="m-0" aria-label={`Failures per day by error class, last ${days.length} days (UTC)`}>
      {present.length > 0 && (
        <ul className="m-0 mb-2.5 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-xs text-muted">
          {present.map((c) => (
            <li key={c}>
              <Swatch c={c} />
              {c}
            </li>
          ))}
        </ul>
      )}
      <BarChart
        maxLabel={`${max} failures`}
        labelEvery={days.length > 14 ? 5 : 2}
        bars={days.map((d) => {
          const here = CLASS_ORDER.filter((c) => d.by_class[c]);
          return {
            key: d.day,
            label: dayLabel(d.day),
            total: d.total,
            empty: d.total === 0,
            segments: here.map((c) => ({ key: c, value: d.by_class[c], fill: CLASS_FILL[c] })),
            tip: (
              <>
                <strong>{dayLabel(d.day)}</strong>
                {d.total === 0 ? (
                  <span className="text-muted">no failures</span>
                ) : (
                  <>
                    {here.map((c) => (
                      <span key={c} className="flex justify-between gap-3 font-mono text-muted">
                        <span className="font-sans text-fg">
                          <Swatch c={c} />
                          {c}
                        </span>
                        {d.by_class[c]}
                      </span>
                    ))}
                    <span className="flex justify-between gap-3 font-mono text-muted">
                      <span className="font-sans text-fg">total</span>
                      {d.total}
                    </span>
                  </>
                )}
              </>
            ),
          };
        })}
      />
      <ChartTable>
        <Table>
          <thead>
            <TableRow>
              <TableHead>Day (UTC)</TableHead>
              {CLASS_ORDER.map((c) => (
                <TableHead key={c} numeric>
                  {c}
                </TableHead>
              ))}
              <TableHead numeric>Total</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <TableRow key={d.day}>
                <TableCell>{d.day}</TableCell>
                {CLASS_ORDER.map((c) => (
                  <TableCell key={c} numeric>
                    {d.by_class[c] || ''}
                  </TableCell>
                ))}
                <TableCell numeric>{d.total}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </ChartTable>
    </figure>
  );
}
