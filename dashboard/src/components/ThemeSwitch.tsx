'use client';

import { useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

// Cycles system -> light -> dark. The choice goes into a cookie, so the server renders the
// page in it from the first byte (no flash); "system" removes the cookie.
export default function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

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
    <button type="button" className="theme-switch" onClick={cycle}
      title={`Theme: ${theme}. Click for ${NEXT[theme]}.`} aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}>
      Theme: {theme}
    </button>
  );
}
