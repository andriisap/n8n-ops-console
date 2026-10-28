import { cn } from '@/lib/utils';

export type Segment = { key: string; value: number; fill: string };
export type Bar = {
  key: string;
  label: string; // x-axis label (shown on every n-th bar, counted back from the last)
  total: number;
  segments: Segment[]; // bottom to top; one segment = a plain bar
  tip: React.ReactNode; // exact numbers, shown on hover and keyboard focus
  empty?: boolean; // nothing happened that day: no mark at all
};

// Bars from a shared baseline, a recessive axis, the maximum written at the top. Every column
// is a focusable hit target taller than its bar, with the numbers in a tooltip. Rendered on
// the server: no chart library and no client JavaScript. A table view sits under each chart.
// Segments grow by their share of the bar: raw values (dollars) can sum below 1, and
// flex-grow below 1 in total fills only that fraction of the bar.
export function BarChart({ bars, maxLabel, labelEvery }: { bars: Bar[]; maxLabel: string; labelEvery: number }) {
  const max = Math.max(...bars.map((b) => b.total), 0);
  const n = bars.length;

  return (
    <div className="relative pt-[18px]">
      <div className="absolute top-0 left-0 font-mono text-[11px] text-muted">{max > 0 ? maxLabel : ''}</div>
      <div
        className="grid h-[180px] gap-0.5 border-y [border-top-style:dashed] border-border"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {bars.map((b, i) => {
          const height = max > 0 ? Math.max((b.total / max) * 100, b.total > 0 ? 2 : 0) : 0;
          const edge = i < 2 ? 'left-0' : i >= n - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2';
          return (
            <div
              key={b.key}
              tabIndex={0}
              className="group relative flex items-end justify-center rounded-t-md outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              {!b.empty && (
                <div
                  className="flex w-[min(70%,36px)] flex-col-reverse gap-0.5 group-hover:brightness-110"
                  style={{ height: `${height}%` }}
                >
                  {b.segments
                    .filter((s) => s.value > 0)
                    .map((s, j, all) => (
                      <div
                        key={s.key}
                        className={cn('min-h-0.5', s.fill, j === all.length - 1 && 'rounded-t')}
                        style={{ flexGrow: s.value / b.total }}
                      />
                    ))}
                </div>
              )}
              <div
                role="tooltip"
                className={cn(
                  'absolute bottom-[calc(100%+6px)] z-10 hidden flex-col gap-px rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-fg shadow-lg group-hover:flex group-focus-visible:flex',
                  edge,
                )}
              >
                {b.tip}
              </div>
              <div
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted max-md:text-[10px]"
                aria-hidden
              >
                {(n - 1 - i) % labelEvery === 0 ? b.label : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// The table view under a chart.
export function ChartTable({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-7 pb-2">
      <summary>Show as table</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
