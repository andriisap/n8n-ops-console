'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export type Theme = 'system' | 'light' | 'dark';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

// Cycles system -> light -> dark. The choice goes into a cookie, so the server renders the
// page in it from the first byte (no flash); "system" removes the cookie.
export default function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const Icon = ICON[theme];

  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') {
      delete root.dataset.theme;
      document.cookie = 'theme=; Path=/; Max-Age=0; SameSite=Lax';
    } else {
      root.dataset.theme = next;
      document.cookie = `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      className="rounded-full border-border"
      title={`Theme: ${theme}. Click for ${NEXT[theme]}.`}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
      data-testid="theme-switch"
    >
      <Icon aria-hidden className="!size-3.5" />
      Theme: {theme}
    </Button>
  );
}
