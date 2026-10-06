import { useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { CrudSection } from '../../components/CrudSection';
import { Button, Chip, ErrorBanner, Field, Loading, Modal, PageHeader, StatusChip, Table, useToast } from '../../components/ui';
import { formatClock, formatDate, formatINR, formatLitres } from '../../../shared/format';

interface Wing { id: number; name: string }
interface Tank { id: number; name: string; type: 'sump' | 'overhead'; capacityLitres: number; wingId: number | null; alertPct: number; isActive: boolean }
interface Vendor { id: number; name: string; area: string; phone: string; upiId: string | null; ratePer10kPaise: number; isActive: boolean }
interface Size { id: number; litres: number; label: string; isActive: boolean }
interface Slot { id: number; label: string; startTime: string; endTime: string; isActive: boolean }
interface Sched { id: number; weekday: number; startTime: string; endTime: string; authority: 'PMC' | 'PCMC'; isActive: boolean }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const active = (v: boolean) => (v ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>);

/** Admin pages that are plain lists of editable records. */
export default function AdminEntities({ kind }: { kind: 'tanks' | 'vendors' | 'options' | 'municipal' }) {
  if (kind === 'tanks') return <TanksAdmin />;
  if (kind === 'vendors') return <VendorsAdmin />;
  if (kind === 'options') return <OptionsAdmin />;
  return <MunicipalAdmin />;
}

function TanksAdmin() {
  const wings = useApi<{ items: Wing[] }>('/admin/wings');
  const [readingFor, setReadingFor] = useState<Tank | null>(null);
  const [level, setLevel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const wingName = (id: number | null) => wings.data?.items.find((w) => w.id === id)?.name ?? '—';

  async function saveReading() {
    if (!readingFor) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/tanks/${readingFor.id}/readings`, { body: { levelPct: Number(level) } });
      toast(`Reading saved for ${readingFor.name}`);
      setReadingFor(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Tanks" subtitle="Sumps and overhead tanks, their capacity and low-level alert" />
      <CrudSection<Tank>
        title="Tanks"
        endpoint="/admin/tanks"
        itemName="tank"
        columns={[
          { label: 'Name', render: (t) => <span className="font-semibold">{t.name}</span> },
          { label: 'Type', render: (t) => (t.type === 'sump' ? 'Sump (underground)' : 'Overhead') },
          { label: 'Capacity', render: (t) => formatLitres(t.capacityLitres), className: 'num' },
          { label: 'Wing', render: (t) => wingName(t.wingId) },
          { label: 'Alert below', render: (t) => `${t.alertPct}%` },
          { label: 'Status', render: (t) => active(t.isActive) },
        ]}
        rowActions={(t) => <Button size="sm" variant="ghost" onClick={() => { setLevel(''); setErr(null); setReadingFor(t); }}>Manual reading</Button>}
        fields={[
          { key: 'name', label: 'Tank name', type: 'text', required: true, placeholder: 'B-Wing Overhead' },
          { key: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'sump', label: 'Sump (underground)' }, { value: 'overhead', label: 'Overhead' }] },
          { key: 'capacityLitres', label: 'Capacity (litres)', type: 'number', required: true, min: 500 },
          { key: 'wingId', label: 'Wing', type: 'select', nullable: true, placeholder: 'Whole society', options: wings.data?.items.map((w) => ({ value: w.id, label: `Wing ${w.name}` })) ?? [] },
          { key: 'alertPct', label: 'Low-level alert (%)', type: 'number', required: true, min: 5, max: 90, hint: 'Dashboard turns orange and alerts below this level' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ]}
        defaults={{ name: '', type: 'overhead', capacityLitres: 25000, wingId: null, alertPct: 30, isActive: true }}
      />
      <Modal open={Boolean(readingFor)} onClose={() => setReadingFor(null)} title={`Manual reading — ${readingFor?.name ?? ''}`} footer={<><Button variant="secondary" onClick={() => setReadingFor(null)}>Cancel</Button><Button busy={busy} onClick={saveReading} disabled={level === ''}>Save reading</Button></>}>
        <ErrorBanner error={err} />
        <Field label="Current level (%)" hint={readingFor && level !== '' ? `≈ ${formatLitres((Number(level) / 100) * readingFor.capacityLitres)} of ${formatLitres(readingFor.capacityLitres)}` : 'From the gauge or dip-stick'}>
          {(id, d) => <input id={id} aria-describedby={d} type="number" inputMode="decimal" min={0} max={100} step={0.5} className="input" value={level} onChange={(e) => setLevel(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}

function VendorsAdmin() {
  const [history, setHistory] = useState<Vendor | null>(null);
  return (
    <>
      <PageHeader title="Vendors" subtitle="Private tanker suppliers. Deactivate a vendor to hide it from new bookings while keeping its history." />
      <CrudSection<Vendor>
        title="Vendors"
        endpoint="/admin/vendors"
        itemName="vendor"
        columns={[
          { label: 'Vendor', render: (v) => <div><div className="font-semibold">{v.name}</div><div className="text-muted">{v.area}</div></div> },
          { label: 'Rate / 10,000 L', render: (v) => formatINR(v.ratePer10kPaise), className: 'num' },
          { label: 'Phone', render: (v) => <a className="text-primary" href={`tel:+91${v.phone}`}>{v.phone}</a> },
          { label: 'UPI ID', render: (v) => v.upiId ?? '—' },
          { label: 'Status', render: (v) => active(v.isActive) },
        ]}
        rowActions={(v) => <Button size="sm" variant="ghost" onClick={() => setHistory(v)}>History</Button>}
        fields={[
          { key: 'name', label: 'Vendor name', type: 'text', required: true },
          { key: 'area', label: 'Area', type: 'text', required: true, placeholder: 'Wagholi' },
          { key: 'phone', label: 'Mobile number', type: 'tel', required: true, placeholder: '98XXXXXXXX' },
          { key: 'upiId', label: 'UPI ID', type: 'text', placeholder: 'name@okaxis' },
          { key: 'ratePer10kPaise', label: 'Rate per 10,000 L (₹)', type: 'rupees', required: true, min: 1 },
          { key: 'isActive', label: 'Active (available for new bookings)', type: 'checkbox' },
        ]}
        defaults={{ name: '', area: '', phone: '', upiId: '', ratePer10kPaise: 180000, isActive: true }}
      />
      {history && <VendorHistory vendor={history} onClose={() => setHistory(null)} />}
    </>
  );
}

interface HistoryRow { code: string; date: string; count: number; size_litres: number; status: string; cost_paise: number; vehicle_number: string | null; litres_received: number | null; short_by_litres: number | null; on_time: number | null }

export function VendorHistory({ vendor, onClose }: { vendor: { id: number; name: string }; onClose: () => void }) {
  const { data, error, loading } = useApi<{ history: HistoryRow[] }>(`/vendors/${vendor.id}/history`);
  const delivered = data?.history.filter((h) => h.litres_received != null) ?? [];
  const onTime = delivered.filter((h) => h.on_time).length;
  const shorts = delivered.filter((h) => (h.short_by_litres ?? 0) > 0).length;
  return (
    <Modal open onClose={onClose} title={`${vendor.name} — performance`} wide>
      <ErrorBanner error={error} />
      {loading && <Loading />}
      {data && (
        <>
          <p className="mb-3 text-sm text-muted">
            Last {data.history.length} bookings · {delivered.length} delivered · {delivered.length ? Math.round((onTime / delivered.length) * 100) : 0}% on time · {shorts} short
          </p>
          <Table label="Vendor history">
            <thead><tr><th className="th">Date</th><th className="th">Code</th><th className="th">Ordered</th><th className="th">Received</th><th className="th">Cost</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.code}>
                  <td className="td">{formatDate(h.date)}</td>
                  <td className="td font-medium">{h.code}</td>
                  <td className="td num">{formatLitres(h.size_litres * h.count)}</td>
                  <td className="td num">{h.litres_received == null ? '—' : formatLitres(h.litres_received)}</td>
                  <td className="td num">{formatINR(h.cost_paise)}</td>
                  <td className="td"><div className="flex flex-wrap gap-1"><StatusChip status={h.status} shortBy={h.short_by_litres} />{h.on_time === 0 && <span className="text-xs font-semibold text-warn">Late</span>}</div></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Modal>
  );
}

function OptionsAdmin() {
  return (
    <>
      <PageHeader title="Tanker sizes & delivery slots" subtitle="These are the choices shown on the Book a tanker screen" />
      <div className="space-y-4">
        <CrudSection<Size>
          title="Tanker sizes"
          endpoint="/admin/sizes"
          itemName="size"
          allowDelete
          columns={[
            { label: 'Label', render: (s) => <span className="font-semibold">{s.label}</span> },
            { label: 'Litres', render: (s) => formatLitres(s.litres), className: 'num' },
            { label: 'Status', render: (s) => active(s.isActive) },
          ]}
          fields={[
            { key: 'litres', label: 'Litres', type: 'number', required: true, min: 1000, max: 50000 },
            { key: 'label', label: 'Label', type: 'text', required: true, placeholder: '10,000 L (standard)' },
            { key: 'isActive', label: 'Show in booking screen', type: 'checkbox' },
          ]}
          defaults={{ litres: 10000, label: '', isActive: true }}
        />
        <CrudSection<Slot>
          title="Delivery slots"
          endpoint="/admin/slots"
          itemName="slot"
          allowDelete
          columns={[
            { label: 'Label', render: (s) => <span className="font-semibold">{s.label}</span> },
            { label: 'Time', render: (s) => `${formatClock(s.startTime)} – ${formatClock(s.endTime)}` },
            { label: 'Status', render: (s) => active(s.isActive) },
          ]}
          fields={[
            { key: 'label', label: 'Label', type: 'text', required: true, placeholder: 'Early morning' },
            { key: 'startTime', label: 'Starts', type: 'time', required: true },
            { key: 'endTime', label: 'Ends', type: 'time', required: true, hint: 'Arrivals after this time are counted as late' },
            { key: 'isActive', label: 'Show in booking screen', type: 'checkbox' },
          ]}
          defaults={{ label: '', startTime: '06:00', endTime: '08:00', isActive: true }}
        />
      </div>
    </>
  );
}

function MunicipalAdmin() {
  return (
    <>
      <PageHeader title="Municipal supply schedule" subtitle="PMC / PCMC usually supply on alternate days. Add one row per supply day." />
      <CrudSection<Sched>
        title="Supply days"
        endpoint="/admin/municipal-schedule"
        itemName="supply day"
        allowDelete
        columns={[
          { label: 'Day', render: (s) => <span className="font-semibold">{WEEKDAYS[s.weekday]}</span> },
          { label: 'Time', render: (s) => `${formatClock(s.startTime)} – ${formatClock(s.endTime)}` },
          { label: 'Authority', render: (s) => s.authority },
          { label: 'Status', render: (s) => active(s.isActive) },
        ]}
        fields={[
          { key: 'weekday', label: 'Day of week', type: 'select', required: true, options: WEEKDAYS.map((d, i) => ({ value: i, label: d })) },
          { key: 'startTime', label: 'Starts', type: 'time', required: true },
          { key: 'endTime', label: 'Ends', type: 'time', required: true },
          { key: 'authority', label: 'Supply authority', type: 'select', required: true, options: [{ value: 'PMC', label: 'PMC (Pune Municipal Corporation)' }, { value: 'PCMC', label: 'PCMC (Pimpri-Chinchwad)' }] },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ]}
        defaults={{ weekday: 1, startTime: '05:30', endTime: '07:30', authority: 'PMC', isActive: true }}
      />
    </>
  );
}
