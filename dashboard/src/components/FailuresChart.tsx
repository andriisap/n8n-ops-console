import type { DayFailures } from '@/lib/metrics';

// Stack order, bottom to top: the order the fill palette was validated in (adjacent pairs).
export const CLASS_ORDER = ['transient', 'rate_limit', 'auth', 'validation', 'unknown'] as const;

const label = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Failures per UTC day, stacked by error class. Legend always shown (several series);
// exact numbers in a tooltip per day and in the table under the chart.
export default function FailuresChart({ days }: { days: DayFailures[] }) {
  const max = Math.max(...days.map((d) => d.total), 0);
  const present = CLASS_ORDER.filter((c) => days.some((d) => d.by_class[c]));
  const every = days.length > 14 ? 5 : 2;

  return (
    <figure className="chart" aria-label={`Failures per day by error class, last ${days.length} days (UTC)`}>
      {present.length > 0 && (
        <ul className="legend">
          {present.map((c) => (
            <li key={c}>
              <span className={`swatch f-${c}`} />
              {c}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-plot">
        <div className="chart-max">{max > 0 ? `${max} failures` : ''}</div>
        <div className="bars" style={{ '--n': days.length } as React.CSSProperties}>
          {days.map((d, i) => (
            <div className="bar-col" key={d.day} tabIndex={0}>
              <div className="stack" style={{ height: `${max > 0 ? (d.total / max) * 100 : 0}%` }}>
                {CLASS_ORDER.filter((c) => d.by_class[c]).map((c) => (
                  <div key={c} className={`seg f-${c}`} style={{ flexGrow: d.by_class[c] }} />
                ))}
              </div>
              <div className="tip" role="tooltip">
                <strong>{label(d.day)}</strong>
                {d.total === 0 ? (
                  <span>no failures</span>
                ) : (
                  CLASS_ORDER.filter((c) => d.by_class[c]).map((c) => (
                    <span className="row" key={c}>
                      <b>
                        <span className={`swatch f-${c}`} />
                        {c}
                      </b>
                      {d.by_class[c]}
                    </span>
                  ))
                )}
                {d.total > 0 && (
                  <span className="row">
                    <b>total</b>
                    {d.total}
                  </span>
                )}
              </div>
              <div className="bar-x" aria-hidden="true">
                {(days.length - 1 - i) % every === 0 ? label(d.day) : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Day (UTC)</th>
                {CLASS_ORDER.map((c) => (
                  <th key={c} className="num">
                    {c}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  {CLASS_ORDER.map((c) => (
                    <td key={c} className="num">
                      {d.by_class[c] || ''}
                    </td>
                  ))}
                  <td className="num">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
