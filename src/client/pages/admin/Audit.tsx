import { Fragment, useState } from 'react';
import { useApi } from '../../lib/api';
import { formatDateTime } from '../../../shared/format';
import { Button, Card, Chip, Empty, ErrorBanner, Field, Loading, PageHeader, Table } from '../../components/ui';

interface Row { id: number; user_id: number | null; user_name: string | null; action: string; entity: string; entity_id: string | null; before_json: string | null; after_json: string | null; ip: string | null; created_at: string }
interface Res { items: Row[]; total: number; page: number; pageSize: number; actions: string[]; entities: string[] }

const actionTone = (a: string) => (a.includes('fail') || a.includes('lock') || a === 'delete' || a.includes('revoke') ? 'red' : a === 'create' || a === 'login' ? 'green' : a === 'update' ? 'blue' : 'grey');

export default function AdminAudit() {
  const [filters, setFilters] = useState({ q: '', action: '', entity: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const qs = new URLSearchParams(Object.entries({ ...applied, page: String(page) }).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useApi<Res>(`/admin/audit?${qs}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every create, update and delete, plus sign-ins and failed attempts" />
      <Card className="mb-4">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}
        >
          <Field label="Search" className="lg:col-span-2">{(id) => <input id={id} className="input" placeholder="Name, IP, value…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />}</Field>
          <Field label="Action">
            {(id) => (
              <select id={id} className="input" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
                <option value="">All</option>
                {data?.actions.map((a) => <option key={a}>{a}</option>)}
              </select>
            )}
          </Field>
          <Field label="Entity">
            {(id) => (
              <select id={id} className="input" value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
                <option value="">All</option>
                {data?.entities.map((a) => <option key={a}>{a}</option>)}
              </select>
            )}
          </Field>
          <Field label="From">{(id) => <input id={id} type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />}</Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit" icon="search">Apply filters</Button>
            <Button variant="secondary" onClick={() => { const empty = { q: '', action: '', entity: '', from: '', to: '' }; setFilters(empty); setApplied(empty); setPage(1); }}>Clear</Button>
          </div>
        </form>
      </Card>
      <Card>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty icon="shield">No matching events.</Empty> : (
          <>
            <Table label="Audit events">
              <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Entity</th><th className="th">IP</th><th className="th" /></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="td whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="td">{r.user_name ?? <span className="text-muted">{r.user_id ? `#${r.user_id}` : 'system / anonymous'}</span>}</td>
                      <td className="td"><Chip tone={actionTone(r.action)}>{r.action}</Chip></td>
                      <td className="td">{r.entity}{r.entity_id && <span className="text-muted"> #{r.entity_id}</span>}</td>
                      <td className="td text-muted">{r.ip ?? '—'}</td>
                      <td className="td text-right">
                        {(r.before_json || r.after_json) && (
                          <Button size="sm" variant="ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6} className="td bg-page">
                          <div className="grid gap-3 md:grid-cols-2">
                            {r.before_json && <div><div className="mb-1 text-xs font-semibold uppercase text-muted">Before</div><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs ring-1 ring-line">{JSON.stringify(JSON.parse(r.before_json), null, 2)}</pre></div>}
                            {r.after_json && <div><div className="mb-1 text-xs font-semibold uppercase text-muted">After</div><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs ring-1 ring-line">{JSON.stringify(JSON.parse(r.after_json), null, 2)}</pre></div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-sm text-muted">{data.total.toLocaleString('en-IN')} events · page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
