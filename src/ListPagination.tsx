import { useState, type ReactNode } from 'react';

export const pageSize = 50;

export function PageControls({ page, total, label, onPage }: { page: number; total: number; label: string; onPage: (page: number) => void }) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  return total > pageSize && <nav className="pagination" aria-label={label + '分页'}>
    <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button>
    <span>第 {page + 1} / {count} 页 · 共 {total} 条</span>
    <button type="button" disabled={page + 1 >= count} onClick={() => onPage(page + 1)}>下一页</button>
  </nav>;
}

export function ListPagination<T>({ rows, label, render }: { rows: T[]; label: string; render: (row: T, index: number) => ReactNode }) {
  const [requestedPage, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, count - 1);
  return <>
    <ul>{rows.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => render(row, page * pageSize + index))}</ul>
    <PageControls page={page} total={rows.length} label={label} onPage={setPage}/>
  </>;
}
