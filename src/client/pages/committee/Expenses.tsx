import { useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { EXPENSE_MANAGERS } from '../../../shared/roles';
import { formatDate, formatINR, formatMonth, istDate } from '../../../shared/format';
import { Button, Card, Empty, ErrorBanner, Field, Loading, Modal, PageHeader, Stat, Table, useToast } from '../../components/ui';

interface Expense { id: number; paid_date: string; description: string; vendor: string | null; booking_code: string | null; amount_paise: number; payment_mode: string; reference: string | null; created_by_name: string | null }
interface Unpaid { id: number; code: string; date: string; vendor_id: number; vendor: string; upi_id: string | null; amount_paise: number }
interface Res { month: string; expenses: Expense[]; unpaidBookings: Unpaid[]; paidTotalPaise: number; tankerSpendPaise: number; budgetPaise: number; costPerFlatPaise: number }

const MODES = { upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque' } as const;
type Mode = keyof typeof MODES;
type Form = { bookingId: number | null; vendorId: number | null; description: string; amount: string; paymentMode: Mode; paidDate: string; reference: string };

export default function Expenses() {
  const [month, setMonth] = useState(istDate().slice(0, 7));
  const { data, error, loading, reload } = useApi<Res>(`/expenses?month=${month}`);
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user && EXPENSE_MANAGERS.includes(user.role);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blank = (): Form => ({ bookingId: null, vendorId: null, description: '', amount: '', paymentMode: 'upi', paidDate: istDate(), reference: '' });
  const payFor = (u: Unpaid): Form => ({ bookingId: u.id, vendorId: u.vendor_id, description: `Tanker ${u.code} — ${u.vendor}`, amount: String(u.amount_paise / 100), paymentMode: 'upi', paidDate: istDate(), reference: '' });

  async function save() {
    if (!form) return;
    setBusy(true);
    setFormError(null);
    try {
      await api('/expenses', { body: { bookingId: form.bookingId, vendorId: form.vendorId, description: form.description, amountPaise: Math.round(Number(form.amount) * 100), paymentMode: form.paymentMode, paidDate: form.paidDate, reference: form.reference || null } });
      toast('Payment recorded');
      setForm(null);
      void reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: Expense) {
    if (!window.confirm(`Delete "${e.description}" (${formatINR(e.amount_paise)})?`)) return;
    try {
      await api(`/expenses/${e.id}`, { method: 'DELETE' });
      toast('Expense deleted');
      void reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Vendor payments and other water costs"
        actions={
          <>
            <label htmlFor="exp-month" className="sr-only">Month</label>
            <input id="exp-month" type="month" className="input w-44" value={month} max={istDate().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            {canEdit && <Button icon="plus" onClick={() => { setFormError(null); setForm(blank()); }}>Add expense</Button>}
          </>
        }
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon="truck" label={`Tanker spend, ${formatMonth(data.month)}`} value={formatINR(data.tankerSpendPaise)} sub={`Budget ${formatINR(data.budgetPaise)}`} tone={data.tankerSpendPaise > data.budgetPaise ? 'warn' : 'default'} />
            <Stat icon="check" label="Paid this month" value={formatINR(data.paidTotalPaise)} sub={`${data.expenses.length} payments`} />
            <Stat icon="clock" label="Unpaid deliveries" value={formatINR(data.unpaidBookings.reduce((a, u) => a + u.amount_paise, 0))} sub={`${data.unpaidBookings.length} bookings`} tone={data.unpaidBookings.length ? 'warn' : 'default'} />
            <Stat icon="building" label="Cost per flat" value={formatINR(data.costPerFlatPaise)} />
          </div>

          {data.unpaidBookings.length > 0 && (
            <Card title="Delivered, not yet paid">
              <Table label="Unpaid deliveries">
                <thead><tr><th className="th">Booking</th><th className="th">Vendor</th><th className="th text-right">Amount</th><th className="th" /></tr></thead>
                <tbody>
                  {data.unpaidBookings.slice(0, 20).map((u) => (
                    <tr key={u.id}>
                      <td className="td"><div className="font-semibold">{u.code}</div><div className="text-xs text-muted">{formatDate(u.date)}</div></td>
                      <td className="td">{u.vendor}{u.upi_id && <div className="text-xs text-muted">{u.upi_id}</div>}</td>
                      <td className="td text-right num">{formatINR(u.amount_paise)}</td>
                      <td className="td text-right">{canEdit && <Button size="sm" variant="secondary" onClick={() => { setFormError(null); setForm(payFor(u)); }}>Record payment</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card title={`Payments — ${formatMonth(data.month)}`}>
            {!data.expenses.length ? <Empty icon="rupee">No payments recorded this month.</Empty> : (
              <Table label="Payments">
                <thead><tr><th className="th">Date</th><th className="th">Description</th><th className="th">Mode</th><th className="th text-right">Amount</th><th className="th" /></tr></thead>
                <tbody>
                  {data.expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="td whitespace-nowrap">{formatDate(e.paid_date)}</td>
                      <td className="td">{e.description}<div className="text-xs text-muted">{[e.vendor, e.reference, e.created_by_name && `by ${e.created_by_name}`].filter(Boolean).join(' · ')}</div></td>
                      <td className="td">{MODES[e.payment_mode as Mode] ?? e.payment_mode}</td>
                      <td className="td text-right num font-semibold">{formatINR(e.amount_paise)}</td>
                      <td className="td text-right">{canEdit && <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(e)}>Delete</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.bookingId ? 'Record payment' : 'Add expense'} footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button busy={busy} onClick={save} disabled={!form?.description || !form.amount}>Save</Button></>}>
        {form && (
          <div className="space-y-3">
            <ErrorBanner error={formError} />
            <Field label="Description">{(id) => <input id={id} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Pump repair" />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹)">{(id) => <input id={id} type="number" inputMode="decimal" min={0} step={0.01} className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
              <Field label="Paid on">{(id) => <input id={id} type="date" className="input" max={istDate()} value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />}</Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment mode">
                {(id) => <select id={id} className="input" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value as Mode })}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
              </Field>
              <Field label="Reference (UTR / cheque no.)">{(id) => <input id={id} className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
