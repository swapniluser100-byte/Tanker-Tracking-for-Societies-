import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { APPROVERS, BOOKING_MANAGERS } from '../../../shared/roles';
import { formatClock, formatDate, formatDateTime, formatINR, formatLitres } from '../../../shared/format';
import type { BookingRow } from '../../lib/types';
import { Button, Card, Empty, ErrorBanner, Field, Loading, Modal, PageHeader, StatusChip, Table, useToast } from '../../components/ui';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending_approval', label: 'Needs approval' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'on_the_way', label: 'On the way' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const qs = new URLSearchParams({ ...(status && { status }), ...(query && { q: query }), limit: '200' }).toString();
  const { data, error, loading, reload } = useApi<{ bookings: BookingRow[] }>(`/bookings?${qs}`);
  const { user } = useAuth();
  const toast = useToast();
  const [photo, setPhoto] = useState<BookingRow | null>(null);
  const [dispatching, setDispatching] = useState<BookingRow | null>(null);
  const [eta, setEta] = useState('45');
  const canApprove = user && APPROVERS.includes(user.role);
  const canManage = user && BOOKING_MANAGERS.includes(user.role);

  async function act(b: BookingRow, action: 'approve' | 'reject' | 'cancel', confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(`/bookings/${b.id}/${action}`, { body: {} });
      toast(`${b.code} ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'}`);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function dispatch() {
    if (!dispatching) return;
    try {
      await api(`/bookings/${dispatching.id}/dispatch`, { body: { etaMinutes: Number(eta) } });
      toast(`${dispatching.code} marked on the way`);
      setDispatching(null);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Tanker bookings"
        actions={canManage && <Link to="/app/book" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-primary px-4 font-semibold text-white">Book tanker</Link>}
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" role="tab" aria-selected={status === f.value}
                onClick={() => setParams(f.value ? { status: f.value } : {})}
                className={`min-h-11 rounded-full px-3 text-sm font-semibold ${status === f.value ? 'bg-ink text-white' : 'text-muted hover:bg-page'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
            <label htmlFor="bk-search" className="sr-only">Search bookings</label>
            <input id="bk-search" className="input w-56" placeholder="Code, vendor or vehicle" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="secondary" icon="search">Search</Button>
          </form>
        </div>
        <ErrorBanner error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : !data?.bookings.length ? <Empty icon="truck">No bookings match.</Empty> : (
          <Table label="Bookings">
            <thead>
              <tr><th className="th">Booking</th><th className="th">Date & slot</th><th className="th">Vendor</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Cost</th><th className="th">Status</th><th className="th" /></tr>
            </thead>
            <tbody>
              {data.bookings.map((b) => (
                <tr key={b.id}>
                  <td className="td"><div className="font-semibold">{b.code}</div><div className="text-xs text-muted">by {b.booked_by ?? '—'}{b.approved_by ? ` · ✓ ${b.approved_by}` : ''}</div></td>
                  <td className="td whitespace-nowrap">{formatDate(b.date)}<div className="text-xs text-muted">{b.start_time ? `${formatClock(b.start_time)} – ${formatClock(b.end_time!)}` : '—'}</div></td>
                  <td className="td">{b.vendor}<div className="text-xs text-muted">{b.vehicle_number ?? b.tank}</div></td>
                  <td className="td text-right num">{formatLitres(b.size_litres * b.count)}<div className="text-xs text-muted">{b.count} × {formatLitres(b.size_litres)}</div></td>
                  <td className="td text-right num">{b.litres_received == null ? '—' : formatLitres(b.litres_received)}{b.level_before_pct != null && <div className="text-xs text-muted">{b.level_before_pct}% → {b.level_after_pct}%</div>}</td>
                  <td className="td text-right num">{formatINR(b.final_cost_paise ?? b.cost_paise)}{b.final_cost_paise != null && b.final_cost_paise !== b.cost_paise && <div className="text-xs text-muted line-through">{formatINR(b.cost_paise)}</div>}</td>
                  <td className="td">
                    <StatusChip status={b.status} shortBy={b.short_by_litres} />
                    {b.on_time === 0 && <div className="mt-1 text-xs font-semibold text-warn">Late</div>}
                    {b.status === 'on_the_way' && b.eta_at && <div className="mt-1 text-xs text-muted">ETA {formatDateTime(b.eta_at)}</div>}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1">
                      {b.status === 'pending_approval' && canApprove && (
                        <>
                          <Button size="sm" variant="ok" onClick={() => act(b, 'approve')}>Approve</Button>
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(b, 'reject', `Reject ${b.code} for ${formatINR(b.cost_paise)}?`)}>Reject</Button>
                        </>
                      )}
                      {b.status === 'confirmed' && canManage && <Button size="sm" variant="ghost" onClick={() => { setEta('45'); setDispatching(b); }}>On the way</Button>}
                      {['pending_approval', 'confirmed', 'on_the_way'].includes(b.status) && canManage && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(b, 'cancel', `Cancel ${b.code}?`)}>Cancel</Button>
                      )}
                      {b.photo_key && <Button size="sm" variant="ghost" onClick={() => setPhoto(b)}>Photo</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={Boolean(photo)} onClose={() => setPhoto(null)} title={`${photo?.code} — tanker / challan photo`} wide>
        {photo?.photo_key && <img src={`/api/uploads/${photo.photo_key}`} alt={`Tanker ${photo.vehicle_number ?? ''} photo for ${photo.code}`} className="w-full rounded-xl" />}
      </Modal>

      <Modal open={Boolean(dispatching)} onClose={() => setDispatching(null)} title={`${dispatching?.code} is on the way`} footer={<><Button variant="secondary" onClick={() => setDispatching(null)}>Cancel</Button><Button onClick={dispatch}>Save</Button></>}>
        <p className="mb-3 text-sm text-muted">Residents see "Tanker on the way" with this ETA.</p>
        <Field label="Arriving in (minutes)">{(id) => <input id={id} type="number" inputMode="numeric" min={5} max={600} className="input" value={eta} onChange={(e) => setEta(e.target.value)} />}</Field>
      </Modal>
    </>
  );
}
