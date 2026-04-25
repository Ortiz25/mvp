import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';
interface ThemeCtx { theme: Theme; toggle: () => void; isDark: boolean; }
const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {}, isDark: true });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('portal-theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark',  theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    localStorage.setItem('portal-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return <Ctx.Provider value={{ theme, toggle, isDark: theme === 'dark' }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
