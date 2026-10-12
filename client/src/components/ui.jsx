// Small presentational building blocks shared by every page.
import { AlertCircle, Info } from 'lucide-react';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, flush, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone, hero, title, children }) {
  return (
    <div className={`card kpi ${hero ? 'hero' : ''} ${tone ? `kpi-tone-${tone}` : ''}`} title={title}>
      <div className="kpi-label">{Icon && <Icon size={14} />}{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
      {children}
    </div>
  );
}

const SEVERITY_CLASS = { OK: 'b-ok', WARNING: 'b-warning', HIGH: 'b-high', CRITICAL: 'b-critical' };
export function SeverityBadge({ value }) {
  if (!value) return <span className="faint">—</span>;
  return <span className={`badge ${SEVERITY_CLASS[value] || 'b-unknown'}`}><span className="dot" />{value}</span>;
}

const STATUS_CLASS = { SUCCESS: 'b-ok', FAILED: 'b-critical', TIMED_OUT: 'b-high', UNKNOWN: 'b-unknown' };
export function StatusBadge({ value }) {
  if (!value) return <span className="faint">—</span>;
  return <span className={`badge ${STATUS_CLASS[value] || 'b-unknown'}`}>{value.replace('_', ' ')}</span>;
}

export function Badge({ tone = 'unknown', children, title }) {
  return <span className={`badge b-${tone}`} title={title}>{children}</span>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><div className="spinner" />{label}</div>;
}

export function ErrorState({ error }) {
  if (!error) return null;
  const denied = error.status === 403;
  return (
    <div className={`notice ${denied ? '' : 'warn'}`}>
      <AlertCircle size={16} />
      <div>{denied ? 'Your role does not have access to this data.' : error.message}</div>
    </div>
  );
}

export function Notice({ children, tone }) {
  return <div className={`notice ${tone || ''}`}><Info size={16} /><div>{children}</div></div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
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

// Proportional bar, e.g. severity breakdown: segments = [{ value, color, label }]
export function StackBar({ segments }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <>
      <div className="bar" style={{ height: 10 }}>
        {segments.map((s) => <span key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label} <b className="num">{s.value}</b></span>
        ))}
      </div>
    </>
  );
}

export const COLORS = {
  OK: '#16a34a', WARNING: '#d97706', HIGH: '#ea580c', CRITICAL: '#dc2626', UNKNOWN: '#94a3b8',
  SUCCESS: '#16a34a', FAILED: '#dc2626', TIMED_OUT: '#ea580c', accent: '#4f46e5',
};
