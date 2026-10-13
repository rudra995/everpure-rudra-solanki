// Theme (light by default, dark optional) and the chart colours for each theme.
// Charts need real colour values (SVG attributes can't read CSS variables), so the same
// tokens as styles/app.css live here too.
//
// A deliberately small palette around the black / orange look: ink, orange, peach, gray.
//   Snowflake = ink, AWS = orange (hatched in bar charts), latency = orange,
//   refresh = ink, ownership = peach, usage = gray.
// Severity is the only place with more colours: green / yellow / orange / red, always
// shown with a text label so colour never carries the meaning alone.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PALETTE = {
  light: {
    ink: '#1f1f1d', orange: '#f05a28', peach: '#f4a77c', gray: '#9b9b94',
    snowflake: '#1f1f1d', aws: '#f05a28', latency: '#f05a28', refresh: '#1f1f1d', ownership: '#f4a77c', usage: '#9b9b94',
    good: '#3aa76d', warning: '#f2b632', serious: '#f07a32', critical: '#df3b3b', unknown: '#c4c4bd',
    grid: '#ececea', axis: '#9a9a94', text: '#1d1d1b', surface: '#fbfbfa', accent: '#f05a28',
  },
  dark: {
    ink: '#ecece8', orange: '#f26b3a', peach: '#c47a52', gray: '#7d7d77',
    snowflake: '#ecece8', aws: '#f26b3a', latency: '#f26b3a', refresh: '#ecece8', ownership: '#c47a52', usage: '#7d7d77',
    good: '#3aa76d', warning: '#f2b632', serious: '#ef7f3a', critical: '#e5484d', unknown: '#5c5c57',
    grid: '#2a2a28', axis: '#85857e', text: '#f2f2ef', surface: '#1c1c1b', accent: '#f26b3a',
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

// Shared SVG patterns and gradients, rendered once (hidden) and referenced by charts with
// url(#id): hatched orange for AWS bars, soft vertical gradients for area charts.
export function ChartDefs() {
  const { c } = useTheme();
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="pi-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill={c.orange} />
          <line x1="0" y1="0" x2="0" y2="7" stroke={c.peach} strokeWidth="3" />
        </pattern>
        <linearGradient id="pi-grad-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.orange} stopOpacity="0.35" /><stop offset="100%" stopColor={c.orange} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="pi-grad-ink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.ink} stopOpacity="0.28" /><stop offset="100%" stopColor={c.ink} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="pi-bar-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8a5c" /><stop offset="100%" stopColor={c.orange} />
        </linearGradient>
        <linearGradient id="pi-bar-orange-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={c.orange} /><stop offset="100%" stopColor="#ff8a5c" />
        </linearGradient>
      </defs>
    </svg>
  );
}
