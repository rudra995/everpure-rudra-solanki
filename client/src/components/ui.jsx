// Shared presentational building blocks.
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Info } from 'lucide-react';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';

export function PageHeader({ index, eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        {(eyebrow || index) && <div className="eyebrow">{index && <span className="idx">{index}</span>}{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, note }) {
  return <h2 className="section-title">{children}{note && <span>{note}</span>}</h2>;
}

export function Panel({ title, subtitle, actions, flush, bordered, children, className = '', style }) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <div className={`panel-head ${bordered ? 'bordered' : ''}`}>
          <div>
            {title && <div className="panel-title">{title}</div>}
            {subtitle && <div className="panel-sub">{subtitle}</div>}
          </div>
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

// KPI tile: the one number that matters, a plain-English line under it, optional footer
// (e.g. a split bar). `tone` is a palette key used for the small colour marker.
export function Stat({ label, value, unit, sub, tone, foot, to, valueColor }) {
  const { c } = useTheme();
  const navigate = useNavigate();
  return (
    <div className={`panel kpi ${to ? 'link' : ''}`} onClick={to ? () => navigate(to) : undefined}>
      <div className="kpi-label">{tone && <span className="kpi-dot" style={{ background: c[tone] ?? tone }} />}{label}</div>
      <div className="kpi-value" style={valueColor ? { color: valueColor } : undefined}>{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

export function Badge({ color, children, title, dot }) {
  return <span className="badge" style={{ '--c': color }} title={title}>{dot && <span className="dot" />}{children}</span>;
}

export function SeverityBadge({ value }) {
  const { c } = useTheme();
  if (!value) return <span className="faint">—</span>;
  return <Badge color={c[SEVERITY_KEY[value]] ?? c.unknown} dot>{value === 'OK' ? 'OK' : value.charAt(0) + value.slice(1).toLowerCase()}</Badge>;
}

export function StatusBadge({ value }) {
  const { c } = useTheme();
  if (!value) return <span className="faint">—</span>;
  const label = { SUCCESS: 'Success', FAILED: 'Failed', TIMED_OUT: 'Timed out', UNKNOWN: 'Unknown' }[value] ?? value;
  return <Badge color={c[STATUS_KEY[value]] ?? c.unknown}>{label}</Badge>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><div className="spinner" />{label}</div>;
}

export function ErrorState({ error }) {
  if (!error) return null;
  return (
    <div className="notice">
      <AlertCircle size={16} />
      <div>{error.status === 403 ? 'Your role does not have access to this data.' : error.message}</div>
    </div>
  );
}

export function Notice({ children }) {
  return <div className="notice"><Info size={16} /><div>{children}</div></div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.color && <span className="sw" style={{ background: o.color }} />}{o.label}
        </button>
      ))}
    </div>
  );
}

// Proportional split bar with legend. parts: [{ label, value, color, display? }]
export function SplitBar({ parts, thin, legend = true }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value || 0), 0) || 1;
  return (
    <div>
      <div className={`split ${thin ? 'thin' : ''}`}>
        {parts.map((p) => <span key={p.label} style={{ width: `${(Math.max(0, p.value || 0) / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.display ?? p.value}`} />)}
      </div>
      {legend && (
        <div className="legend" style={{ marginTop: 10 }}>
          {parts.map((p) => (
            <span key={p.label}><span className="sw" style={{ background: p.color }} />{p.label}<b>{p.display ?? p.value}</b>
              <span className="faint" style={{ marginLeft: 5 }}>{((Math.max(0, p.value || 0) / total) * 100).toFixed(0)}%</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((i) => <span key={i.label}><span className="sw" style={{ background: i.color }} />{i.label}{i.value !== undefined && <b>{i.value}</b>}</span>)}
    </div>
  );
}

export function Modal({ title, children, footer, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
