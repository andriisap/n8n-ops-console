import { count, usd } from '@/lib/format';
import type { Day } from '@/lib/costs';

// One series (spend per UTC day), so no legend: the heading names it. Bars grow from a
// shared baseline; each column is a hover target taller than its bar, with the exact
// numbers in a tooltip. The same numbers are available as a table below the chart.
export default function DailyCostChart({ days }: { days: Day[] }) {
  const max = Math.max(...days.map((d) => d.cost), 0);
  const label = (d: Day) =>
    new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <figure className="chart" aria-label="LLM spend per day, last 14 days (UTC)">
      <div className="chart-plot">
        <div className="chart-max">{max > 0 ? usd(max) : ''}</div>
        <div className="bars">
          {days.map((d, i) => {
            const h = max > 0 ? Math.max((d.cost / max) * 100, d.cost > 0 ? 2 : 0) : 0;
            return (
              <div className="bar-col" key={d.day} tabIndex={0}>
                <div className="bar" style={{ height: `${h}%` }} data-empty={d.calls === 0 || undefined} />
                <div className="tip" role="tooltip">
                  <strong>{label(d)}</strong>
                  <span>{usd(d.cost)}</span>
                  <span>
                    {d.calls} calls · {d.runs} runs
                  </span>
                  {d.unpriced > 0 && <span className="warn">{d.unpriced} without price</span>}
                </div>
                {/* every other day, counted back from today, so the last label is always today */}
                <div className="bar-x" aria-hidden="true">
                  {(days.length - 1 - i) % 2 === 0 ? label(d) : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Day (UTC)</th>
              <th className="num">Spend</th>
              <th className="num">Calls</th>
              <th className="num">Runs</th>
              <th className="num">No price</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td className="num">{usd(d.cost)}</td>
                <td className="num">{count(d.calls)}</td>
                <td className="num">{count(d.runs)}</td>
                <td className="num">{d.unpriced || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
