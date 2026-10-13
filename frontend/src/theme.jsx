// Theme (light by default, dark optional) and the chart colours for each theme.
// Charts need real colour values (SVG attributes can't read CSS variables), so the same
// tokens as styles/app.css live here too.
//
// A deliberately small palette around the black / orange look: ink, orange, peach, gray.
//   Snowflake = ink, AWS = orange, latency = orange, refresh = ink, ownership = orange,
//   usage = gray. One bar style everywhere: solid ink + orange gradient, rounded ends.
// Severity is the only place with more colours: green / yellow / orange / red, always
// shown with a text label so colour never carries the meaning alone.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PALETTE = {
  light: {
    ink: '#1f1f1d', orange: '#f05a28', peach: '#f4a77c', gray: '#9b9b94',
    snowflake: '#1f1f1d', aws: '#f05a28', latency: '#f05a28', refresh: '#1f1f1d', ownership: '#f05a28', usage: '#9b9b94',
    good: '#3aa76d', warning: '#f2b632', serious: '#f07a32', critical: '#df3b3b', unknown: '#c4c4bd',
    grid: '#ececea', axis: '#9a9a94', text: '#1d1d1b', surface: '#fbfbfa', accent: '#f05a28', barTop: '#ff8a5c',
  },
  dark: {
    ink: '#f2f2ee', orange: '#f05a28', peach: '#f4a77c', gray: '#cfcfc8',
    snowflake: '#f2f2ee', aws: '#f05a28', latency: '#f05a28', refresh: '#f2f2ee', ownership: '#f05a28', usage: '#cfcfc8',
    good: '#45b97a', warning: '#f5c04a', serious: '#f07a32', critical: '#ef5a5a', unknown: '#a3a39c',
    grid: '#2c2c2a', axis: '#a3a39c', text: '#f4f4f1', surface: '#1a1a19', accent: '#f05a28', barTop: '#ff8a5c',
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

// Shared SVG gradients, rendered once (hidden) and referenced by charts with url(#id):
// the orange bar gradient (vertical and horizontal) and soft fills for area charts.
export function ChartDefs() {
  const { c } = useTheme();
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="pi-grad-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.orange} stopOpacity="0.35" /><stop offset="100%" stopColor={c.orange} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="pi-grad-ink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.ink} stopOpacity="0.28" /><stop offset="100%" stopColor={c.ink} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="pi-bar-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.barTop} /><stop offset="100%" stopColor={c.orange} />
        </linearGradient>
        <linearGradient id="pi-bar-orange-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={c.orange} /><stop offset="100%" stopColor={c.barTop} />
        </linearGradient>
      </defs>
    </svg>
  );
}
