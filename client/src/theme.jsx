// Theme (dark by default, light optional) and the chart colours for each theme.
// Charts need real colour values (SVG attributes can't read CSS variables), so the same
// tokens as styles/app.css live here too. Palette validated for colour-blind separation.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PALETTE = {
  dark: {
    snowflake: '#3987e5', aws: '#d95926', usage: '#199e70', ownership: '#c98500', refresh: '#d55181', latency: '#9085e9',
    good: '#22b04b', warning: '#fab219', serious: '#ec835a', critical: '#e5484d', unknown: '#7d8597',
    grid: '#222838', axis: '#6c7385', text: '#e9ecf3', surface: '#121620', accent: '#7c7ff5',
  },
  light: {
    snowflake: '#2a78d6', aws: '#eb6834', usage: '#1baf7a', ownership: '#eda100', refresh: '#e87ba4', latency: '#6250d6',
    good: '#16a34a', warning: '#e09b00', serious: '#e8743f', critical: '#d03b3b', unknown: '#8a93a5',
    grid: '#e8ebf1', axis: '#8a93a5', text: '#0f172a', surface: '#ffffff', accent: '#5b5bd6',
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('pi_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pi_theme', theme); } catch { /* private mode */ }
  }, [theme]);
  const value = useMemo(() => ({
    theme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    c: PALETTE[theme],
  }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// Status colour for a latency severity or a refresh status.
export const SEVERITY_KEY = { OK: 'good', WARNING: 'warning', HIGH: 'serious', CRITICAL: 'critical' };
export const STATUS_KEY = { SUCCESS: 'good', FAILED: 'critical', TIMED_OUT: 'serious', UNKNOWN: 'unknown' };

// Human labels for each metric colour, used by legends.
export const METRIC_LABEL = {
  snowflake: 'Snowflake compute', aws: 'AWS hosting', usage: 'Active views', ownership: 'Ownership',
  refresh: 'Refresh', latency: 'Load latency',
};
