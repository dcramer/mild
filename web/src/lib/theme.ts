import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'sift-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Follows the operating system unless the viewer picks light or dark. Applies the `dark` class shadcn's styles key on. */
export function useTheme(): { theme: Theme; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && system.matches));
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);

  return {
    theme,
    cycle: () => {
      const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system';
      try {
        if (next === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        // Private windows may refuse storage; the choice then lasts for this page only.
      }
      setTheme(next);
    },
  };
}
