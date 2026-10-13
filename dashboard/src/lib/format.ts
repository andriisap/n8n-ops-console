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
