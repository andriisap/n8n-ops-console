import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins class names and lets a later Tailwind class win over an earlier one of the same kind,
// so a component's defaults can be overridden from outside: cn('px-3', props.className).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
