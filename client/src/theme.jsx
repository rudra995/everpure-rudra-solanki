// Theme (light by default, dark optional) and the chart colours for each theme.
// Charts need real colour values (SVG attributes can't read CSS variables), so the same
// tokens as styles/app.css live here too. Both palettes pass the colour-blind and
// contrast checks (dataviz validate_palette.js).
//
// Look: neutral grays, ink-black surfaces for emphasis and an orange accent.
// Metric colours: Snowflake = ink blue, AWS = orange, usage = teal, ownership = gold,
// refresh = raspberry, latency = violet. Severity keeps green / yellow / orange / red.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PALETTE = {
  light: {
    snowflake: '#3558a0', aws: '#f05a28', usage: '#17a08a', ownership: '#dba11e', refresh: '#d6477a', latency: '#7062ee',
    good: '#2fa35a', warning: '#f2b632', serious: '#f07a32', critical: '#df3b3b', unknown: '#a3a39c',
    grid: '#ececea', axis: '#9a9a94', text: '#1d1d1b', surface: '#fbfbfa', accent: '#f05a28', ink: '#1d1d1b',
  },
  dark: {
    snowflake: '#5b86d9', aws: '#e8622f', usage: '#1fa58f', ownership: '#b0800f', refresh: '#d9578c', latency: '#8579ef',
    good: '#34b062', warning: '#f2b632', serious: '#ef7f3a', critical: '#e5484d', unknown: '#85857e',
    grid: '#2a2a28', axis: '#85857e', text: '#f2f2ef', surface: '#1c1c1b', accent: '#f26b3a', ink: '#f2f2ef',
  },
};

const ThemeContext = createContext(null);
const KEY = 'pi_theme_v2';

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  const value = useMemo(() => ({
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    c: PALETTE[theme],
  }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// Status colour for a latency severity or a refresh status.
export const SEVERITY_KEY = { OK: 'good', WARNING: 'warning', HIGH: 'serious', CRITICAL: 'critical' };
export const STATUS_KEY = { SUCCESS: 'good', FAILED: 'critical', TIMED_OUT: 'serious', UNKNOWN: 'unknown' };

export const METRIC_LABEL = {
  snowflake: 'Snowflake compute', aws: 'AWS hosting', usage: 'Active views', ownership: 'Ownership',
  refresh: 'Refresh', latency: 'Load latency',
};
