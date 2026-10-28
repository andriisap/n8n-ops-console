import { BarChart, ChartTable, dayLabel } from '@/components/charts/BarChart';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import type { Day } from '@/lib/costs';
import { count, usd } from '@/lib/format';

// One series (spend per UTC day), so no legend: the heading names it.
export default function DailyCostChart({ days }: { days: Day[] }) {
  const max = Math.max(...days.map((d) => d.cost), 0);

  return (
    <figure className="m-0" aria-label={`LLM spend per day, last ${days.length} days (UTC)`}>
      <BarChart
        maxLabel={usd(max)}
        labelEvery={2}
        bars={days.map((d) => ({
          key: d.day,
          label: dayLabel(d.day),
          total: d.cost,
          empty: d.calls === 0,
          segments: [{ key: 'cost', value: d.cost, fill: 'bg-accent' }],
          tip: (
            <>
              <strong>{dayLabel(d.day)}</strong>
              <span className="font-mono text-muted">{usd(d.cost)}</span>
              <span className="font-mono text-muted">
                {d.calls} calls · {d.runs} runs
              </span>
              {d.unpriced > 0 && <span className="font-mono text-cls-rate-limit">{d.unpriced} without price</span>}
            </>
          ),
        }))}
      />
      <ChartTable>
        <Table>
          <thead>
            <TableRow>
              <TableHead>Day (UTC)</TableHead>
              <TableHead numeric>Spend</TableHead>
              <TableHead numeric>Calls</TableHead>
              <TableHead numeric>Runs</TableHead>
              <TableHead numeric>No price</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <TableRow key={d.day}>
                <TableCell>{d.day}</TableCell>
                <TableCell numeric>{usd(d.cost)}</TableCell>
                <TableCell numeric>{count(d.calls)}</TableCell>
                <TableCell numeric>{count(d.runs)}</TableCell>
                <TableCell numeric>{d.unpriced || ''}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </ChartTable>
    </figure>
  );
}
