// Shared presentational building blocks. Colours come from the theme by metric kind
// (snowflake, aws, usage, latency, refresh, ownership) or by status.
import { AlertCircle, Info } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

// Section: one rounded surface grouping related tiles and charts, with a short heading.
export function Group({ title, subtitle, actions, children }) {
  return (
    <section className="group">
      {(title || actions) && (
        <div className="group-head">
          <div>{title && <div className="group-title">{title}</div>}{subtitle && <div className="group-sub">{subtitle}</div>}</div>
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ title, subtitle, icon: Icon, iconColor, actions, flush, tight, bordered, children, className = '', style }) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <div className={`panel-head ${bordered ? 'bordered' : ''}`}>
          <div>
            {title && <div className="panel-title">{Icon && <Icon size={15} color={iconColor} />}{title}</div>}
            {subtitle && <div className="panel-sub">{subtitle}</div>}
          </div>
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''} ${tight ? 'tight' : ''}`}>{children}</div>
    </section>
  );
}

// Stat tile: coloured icon chip by metric kind, value, sub-line, optional sparkline.
export function Stat({ label, value, unit, sub, icon: Icon, tone = 'accent', spark, sparkKey, title, variant }) {
  const { c } = useTheme();
  const color = c[tone] ?? c.accent;
  const lineColor = variant === 'accent' ? '#ffffff' : color;
  return (
    <div className={`panel stat ${variant ? `${variant}-tile` : ''}`} style={{ '--tone': color }} title={title}>
      <div className="stat-top">
        {Icon && <span className="chip" style={{ background: `${color}22`, color }}><Icon size={14} /></span>}
        {label}
      </div>
      <div className="stat-value">{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {spark && spark.length > 1 && <Sparkline data={spark} dataKey={sparkKey} color={lineColor} />}
    </div>
  );
}

export function Sparkline({ data, dataKey, color, height = 34 }) {
  const id = `sp-${dataKey}-${color.slice(1)}`;
  return (
    <div className="stat-spark" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Badge({ color, children, title, dot }) {
  return <span className="badge" style={{ '--c': color }} title={title}>{dot && <span className="dot" />}{children}</span>;
}

export function SeverityBadge({ value }) {
  const { c } = useTheme();
  if (!value) return <span className="faint">—</span>;
  return <Badge color={c[SEVERITY_KEY[value]] ?? c.unknown} dot>{value}</Badge>;
}

export function StatusBadge({ value }) {
  const { c } = useTheme();
  if (!value) return <span className="faint">—</span>;
  return <Badge color={c[STATUS_KEY[value]] ?? c.unknown}>{value.replace('_', ' ')}</Badge>;
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

// Segmented control. options: [{ value, label, color? }]
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

// Proportional split bar with legend, e.g. Snowflake + AWS. parts: [{ label, value, color, display? }]
export function SplitBar({ parts, thin, legend = true }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className={`split ${thin ? 'thin' : ''}`}>
        {parts.map((p) => <span key={p.label} style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.display ?? p.value}`} />)}
      </div>
      {legend && (
        <div className="legend" style={{ marginTop: 10 }}>
          {parts.map((p) => (
            <span key={p.label}><span className="sw" style={{ background: p.color }} />{p.label}<b>{p.display ?? p.value}</b>
              <span className="faint" style={{ marginLeft: 5 }}>{((Math.max(0, p.value) / total) * 100).toFixed(1)}%</span></span>
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
