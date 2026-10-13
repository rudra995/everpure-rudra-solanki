// Colour palette for charts (SVG attributes can't read CSS variables, so the tokens in
// styles/app.css are mirrored here). One warm light theme.
//
// Metric colours (one per KIND of metric, validated for colour-blind separation):
//   Snowflake = blue, AWS = orange, usage = teal, ownership = gold, refresh = raspberry, latency = violet.
// Severity uses a separate status scale (green / yellow / orange / red), always shown with a label.
import { createContext, useContext } from 'react';

export const PALETTE = {
  snowflake: '#2a78d6', aws: '#ef7d22', usage: '#1f9e78', ownership: '#c08a12', refresh: '#d6457a', latency: '#7c5cd6',
  good: '#3a9e5f', warning: '#e9b230', serious: '#e8702a', critical: '#d23f3a', unknown: '#a3968a',
  grid: '#efe5d8', axis: '#9a8b7c', text: '#2b2118', surface: '#fffaf3', accent: '#e2611b', accentDeep: '#b9470c',
};

const ThemeContext = createContext({ c: PALETTE });
export function ThemeProvider({ children }) {
  return <ThemeContext.Provider value={{ c: PALETTE }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

export const SEVERITY_KEY = { OK: 'good', WARNING: 'warning', HIGH: 'serious', CRITICAL: 'critical' };
export const STATUS_KEY = { SUCCESS: 'good', FAILED: 'critical', TIMED_OUT: 'serious', UNKNOWN: 'unknown' };
