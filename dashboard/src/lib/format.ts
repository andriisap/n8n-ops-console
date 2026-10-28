const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

export function ago(date: Date | string | null, now = Date.now()): string {
  if (!date) return '—';
  const seconds = Math.round((new Date(date).getTime() - now) / 1000);
  if (Math.abs(seconds) < 5) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return '—';
}

export function exact(date: Date | string | null): string {
  if (!date) return '';
  return new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// Money: cents once it's at least a cent, otherwise enough digits to see it (LLM calls
// cost fractions of a cent). null = no price known, never shown as $0.
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no price';
  if (v === 0) return '$0';
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(2)}`;
  if (Math.abs(v) >= 0.0001) return `$${v.toFixed(5)}`;
  return `$${v.toPrecision(2)}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n < 10_000 ? Math.round(n).toLocaleString('en') : compact.format(n);
}

export function perMtok(v: number | null): string {
  return v === null ? '—' : `$${Number(v.toFixed(4))}`;
}

// A duration in seconds, short and readable: 48 s, 3 min, 2 h 15 min, 3.5 days.
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) {
    const h = Math.floor(s / 3600),
      m = Math.round((s % 3600) / 60);
    return m === 0 ? `${h} h` : m === 60 ? `${h + 1} h` : `${h} h ${m} min`;
  }
  return `${Number((s / 86400).toFixed(1))} days`;
}

export function percent(share: number): string {
  if (!Number.isFinite(share)) return '—';
  const p = share * 100;
  return p > 0 && p < 1 ? '<1 %' : `${Math.round(p)} %`;
}
