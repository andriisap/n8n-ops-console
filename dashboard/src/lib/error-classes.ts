import type { ErrorClass } from './incident-filter';

// Class names written out in full so Tailwind finds them in the source. Text colours are for
// reading, fills for chart marks (decision 038).
export const CLASS_TEXT: Record<ErrorClass, string> = {
  rate_limit: 'text-cls-rate-limit',
  transient: 'text-cls-transient',
  auth: 'text-cls-auth',
  validation: 'text-cls-validation',
  unknown: 'text-cls-unknown',
};

export const CLASS_FILL: Record<ErrorClass, string> = {
  rate_limit: 'bg-fill-rate-limit',
  transient: 'bg-fill-transient',
  auth: 'bg-fill-auth',
  validation: 'bg-fill-validation',
  unknown: 'bg-fill-unknown',
};

// Stack order, bottom to top: the order the fill palette was validated in (adjacent pairs).
export const CLASS_ORDER: readonly ErrorClass[] = ['transient', 'rate_limit', 'auth', 'validation', 'unknown'];

export const isErrorClass = (v: string): v is ErrorClass => v in CLASS_TEXT;
