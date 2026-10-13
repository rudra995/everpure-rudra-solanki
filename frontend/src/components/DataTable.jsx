// Sortable, searchable, paginated table. Columns describe how to read and render a row:
//   { key, label, render?, sortValue?, align?: 'right', sortable?: true }
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';

export default function DataTable({
  rows, columns, searchKeys = [], pageSize = 15, initialSort, onRowClick, toolbar, emptyText = 'No rows',
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort || null); // { key, dir: 'asc' | 'desc' }
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }, [rows, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.sortValue || ((r) => r[sort.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = get(a); const y = get(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;   // missing values always last
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);

  const toggleSort = (key) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div>
      {(searchKeys.length > 0 || toolbar) && (
        <div className="toolbar" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          {searchKeys.length > 0 && (
            <div className="search">
              <Search size={14} />
              <input className="input" placeholder="Search…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={`${sortable ? 'sortable' : ''} ${c.align === 'right' ? 'right' : ''}`}
                      onClick={sortable ? () => toggleSort(c.key) : undefined} title={c.title}>
                    {c.label}
                    {active && (sort.dir === 'asc' ? <ArrowUp size={11} style={{ marginLeft: 4 }} /> : <ArrowDown size={11} style={{ marginLeft: 4 }} />)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={columns.length}><div className="empty">{emptyText}</div></td></tr>
            )}
            {visible.map((r, i) => (
              <tr key={r.id ?? r.report_id ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
                    {c.render ? c.render(r) : (r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="table-foot">
          <span>{current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}</span>
          <div className="row">
            <button type="button" className="btn sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <button type="button" className="btn sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        </div>
      )}
      {sorted.length <= pageSize && sorted.length > 0 && (
        <div className="table-foot"><span>{sorted.length} row{sorted.length === 1 ? '' : 's'}</span></div>
      )}
    </div>
  );
}
