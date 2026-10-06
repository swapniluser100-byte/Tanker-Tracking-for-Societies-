import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { GUARD_APP } from '../../../shared/roles';
import { formatDateTime, formatLitres } from '../../../shared/format';
import { formatHours, type TankStatus } from '../../lib/types';
import { Button, Card, ErrorBanner, Field, Loading, Modal, PageHeader, Segmented, useToast } from '../../components/ui';
import { TankCard } from '../../components/water';

interface Reading { level_pct: number; litres: number; source: string; created_at: string }

export default function Tanks() {
  const { data, error, loading, reload } = useApi<{ tanks: TankStatus[]; storage: { litres: number; capacity: number; pct: number; avgDailyUseLitres: number; hoursLeft: number | null } }>('/tanks');
  const { user } = useAuth();
  const [selected, setSelected] = useState<number | null>(null);
  const [hours, setHours] = useState<'48' | '168'>('48');
  const tankId = selected ?? data?.tanks[0]?.id ?? null;
  const tank = data?.tanks.find((t) => t.id === tankId);
  const readings = useApi<{ readings: Reading[] }>(tankId ? `/tanks/${tankId}/readings?hours=${hours}` : null);
  const [manual, setManual] = useState(false);
  const canEnter = user && GUARD_APP.includes(user.role);

  if (loading && !data) return <Loading />;
  return (
    <>
      <PageHeader
        title="Tanks"
        subtitle={data && `${formatLitres(data.storage.litres)} stored of ${formatLitres(data.storage.capacity)} · using ~${formatLitres(data.storage.avgDailyUseLitres)} a day · ${formatHours(data.storage.hoursLeft)} left`}
        actions={canEnter && <Button variant="secondary" onClick={() => setManual(true)}>Enter manual reading</Button>}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.tanks.map((t) => (
              <button key={t.id} type="button" className="text-left" aria-pressed={t.id === tankId} onClick={() => setSelected(t.id)}>
                <div className={t.id === tankId ? 'rounded-[var(--radius-card)] ring-2 ring-primary' : ''}><TankCard tank={t} /></div>
              </button>
            ))}
          </div>
          {tank && (
            <Card title={`${tank.name} — level history`} action={<Segmented label="Time range" value={hours} onChange={setHours} options={[{ value: '48', label: '48 hours' }, { value: '168', label: '7 days' }]} />}>
              <p className="-mt-1 mb-2 text-sm text-muted">7-day average use: {formatLitres(tank.avgDailyUseLitres)} / day. Dashed line = alert level ({tank.alertPct}%).</p>
              {readings.loading && !readings.data ? <Loading /> : (
                <div className="h-64" role="img" aria-label={`${tank.name} level over the last ${hours === '48' ? '48 hours' : '7 days'}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readings.data?.readings ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E6ECF1" />
                      <XAxis dataKey="created_at" tickFormatter={(v: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', hour: 'numeric' }).format(new Date(v))} minTickGap={40} tickLine={false} axisLine={{ stroke: '#C4D0DA' }} tick={{ fill: '#52637A', fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} width={44} tick={{ fill: '#52637A', fontSize: 12 }} />
                      <ReferenceLine y={tank.alertPct} stroke="#9A3412" strokeDasharray="4 4" />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const r = payload[0].payload as Reading;
                        return <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-md"><div className="font-semibold">{r.level_pct}% · {formatLitres(r.litres)}</div><div className="text-muted">{formatDateTime(r.created_at)} · {r.source}</div></div>;
                      }} />
                      <Line type="monotone" dataKey="level_pct" stroke="#0B63B6" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
      {data && <ManualReading open={manual} onClose={() => setManual(false)} tanks={data.tanks} onSaved={() => { void reload(); void readings.reload(); }} />}
    </>
  );
}

function ManualReading({ open, onClose, tanks, onSaved }: { open: boolean; onClose: () => void; tanks: TankStatus[]; onSaved: () => void }) {
  const [tankId, setTankId] = useState(String(tanks[0]?.id ?? ''));
  const [level, setLevel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const t = tanks.find((x) => String(x.id) === tankId);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/tanks/${tankId}/readings`, { body: { levelPct: Number(level) } });
      toast('Reading saved');
      setLevel('');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Manual tank reading" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={level === ''} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBanner error={err} />
        <Field label="Tank">{(id) => <select id={id} className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>{tanks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
        <Field label="Level (%)" hint={t && level !== '' ? `≈ ${formatLitres((Number(level) / 100) * t.capacityLitres)}` : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} type="number" inputMode="decimal" step={0.5} min={0} max={100} className="input" value={level} onChange={(e) => setLevel(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
