import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { uploadCheckinPhoto } from '../../lib/photo';
import { evaluateDelivery, litresReceived, normaliseVehicleNumber } from '../../../shared/calc';
import { formatClock, formatDateTime, formatINR, formatLitres } from '../../../shared/format';
import type { TankStatus } from '../../lib/types';
import { Button, ErrorBanner, Loading, Spinner, StatusChip, cx } from '../../components/ui';
import { Icon, Logo } from '../../components/icons';
import { LogSupplyModal } from '../../components/water';

interface GuardBooking {
  id: number; code: string; date: string; status: string; count: number; size_litres: number; target_tank_id: number; eta_at: string | null;
  vendor: string; vendor_phone: string; slot_label: string | null; start_time: string | null; end_time: string | null;
  vehicle_number: string | null; litres_received: number | null; short_by_litres: number | null; arrived_at: string | null;
}
interface Today { today: string; bookings: GuardBooking[]; tanks: TankStatus[]; toleranceLitres: number }
interface Result { code: string; litresOrdered: number; litresReceived: number; isShort: boolean; shortByLitres: number; costPaise: number; finalCostPaise: number; onTime: boolean }

/** Security guard app: today's expected tankers and the check-in form. Built for small, low-end Android phones. */
export default function GuardApp() {
  const { data, error, loading, reload } = useApi<Today>('/guard/today');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState<GuardBooking | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // Refresh the list every 2 minutes so newly confirmed bookings appear without reloading.
  useEffect(() => {
    if (active) return;
    const t = setInterval(() => void reload(), 120_000);
    return () => clearInterval(t);
  }, [active, reload]);

  const expected = data?.bookings.filter((b) => b.status !== 'delivered') ?? [];
  const done = data?.bookings.filter((b) => b.status === 'delivered') ?? [];

  return (
    <div className="min-h-dvh bg-page pb-10">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white px-4 py-2">
        <Logo />
        <div className="flex items-center gap-1">
          <span className="hidden text-sm font-semibold sm:inline">{user?.name}</span>
          <button type="button" className="grid h-12 w-12 place-items-center rounded-lg text-muted" aria-label="Sign out" onClick={async () => { await logout(); navigate('/login'); }}>
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-3 pt-4">
        {result ? (
          <ResultView result={result} onDone={() => { setResult(null); setActive(null); void reload(); }} />
        ) : active && data ? (
          <CheckinForm booking={active} tank={data.tanks.find((t) => t.id === active.target_tank_id)} tolerance={data.toleranceLitres} onCancel={() => setActive(null)} onDone={setResult} />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-xl font-bold">Today's tankers</h1>
              <button type="button" onClick={() => void reload()} className="flex min-h-12 items-center gap-2 rounded-lg px-3 font-semibold text-primary" aria-label="Refresh list">
                {loading ? <Spinner size={18} /> : <Icon name="arrowRight" className="rotate-90" size={18} />} Refresh
              </button>
            </div>
            <ErrorBanner error={error} onRetry={reload} />
            {loading && !data && <Loading />}
            {data && !expected.length && (
              <div className="card p-6 text-center text-muted"><Icon name="check" size={32} className="mx-auto mb-2 text-ok" />No more tankers expected today.</div>
            )}
            <ul className="space-y-3">
              {expected.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => setActive(b)} className={cx('card flex w-full items-center gap-3 p-4 text-left active:bg-primary-soft', b.status === 'on_the_way' && 'border-primary')}>
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon name="truck" size={28} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold">{b.code}</span>
                        <StatusChip status={b.status} />
                      </div>
                      <div className="truncate font-medium">{b.vendor}</div>
                      <div className="text-sm text-muted">
                        {formatLitres(b.size_litres * b.count)} · {b.start_time ? `${formatClock(b.start_time)}–${formatClock(b.end_time!)}` : 'any time'}
                        {b.date !== data?.today && ' · from yesterday'}
                        {b.status === 'on_the_way' && b.eta_at && ` · ETA ${formatDateTime(b.eta_at)}`}
                      </div>
                    </div>
                    <span className="text-base font-bold text-primary">Check in</span>
                  </button>
                </li>
              ))}
            </ul>

            <button type="button" onClick={() => setLogOpen(true)} className="card mt-4 flex min-h-14 w-full items-center gap-3 p-4 text-left font-semibold">
              <Icon name="drop" className="text-primary" /> Log PMC water supply for today
            </button>

            {done.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-base font-semibold text-muted">Checked in today</h2>
                <ul className="space-y-2">
                  {done.map((b) => (
                    <li key={b.id} className="card flex items-center justify-between gap-2 p-3">
                      <div><div className="font-semibold">{b.code} · {b.vehicle_number}</div><div className="text-sm text-muted">{b.vendor} · {formatDateTime(b.arrived_at)}</div></div>
                      <div className="text-right text-sm"><div className="font-semibold num">{formatLitres(b.litres_received ?? 0)}</div><StatusChip status="delivered" shortBy={b.short_by_litres} /></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>
      <LogSupplyModal open={logOpen} onClose={() => setLogOpen(false)} onSaved={() => {}} />
    </div>
  );
}

function LevelInput({ label, value, onChange, capacity }: { label: string; value: number; onChange: (v: number) => void; capacity: number }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  const set = (v: number) => onChange(Math.min(100, Math.max(0, Math.round(v * 10) / 10)));
  return (
    <div>
      <label htmlFor={id} className="label text-base">{label}</label>
      <div className="flex items-stretch gap-2">
        <button type="button" className="grid h-14 w-16 shrink-0 place-items-center rounded-xl border-2 border-line-strong bg-white text-xl font-bold active:bg-page" aria-label={`${label}: decrease by 0.5%`} onClick={() => set(value - 0.5)}>−0.5</button>
        <div className="relative flex-1">
          <input id={id} type="number" inputMode="decimal" step={0.1} min={0} max={100} className="input h-14 pr-10 text-center font-display text-2xl font-bold" value={Number.isFinite(value) ? value : ''} onChange={(e) => set(Number(e.target.value))} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted">%</span>
        </div>
        <button type="button" className="grid h-14 w-16 shrink-0 place-items-center rounded-xl border-2 border-line-strong bg-white text-xl font-bold active:bg-page" aria-label={`${label}: increase by 0.5%`} onClick={() => set(value + 0.5)}>+0.5</button>
      </div>
      <div className="mt-1 text-sm text-muted num">= {formatLitres((value / 100) * capacity)} in tank</div>
    </div>
  );
}

function CheckinForm({ booking, tank, tolerance, onCancel, onDone }: { booking: GuardBooking; tank?: TankStatus; tolerance: number; onCancel: () => void; onDone: (r: Result) => void }) {
  const capacity = tank?.capacityLitres ?? 0;
  const ordered = booking.size_litres * booking.count;
  const startBefore = tank?.levelPct ?? 0;
  const [vehicle, setVehicle] = useState('');
  const [before, setBefore] = useState(startBefore);
  const [after, setAfter] = useState(Math.min(100, Math.round((startBefore + (capacity ? (ordered / capacity) * 100 : 0)) * 10) / 10));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const received = litresReceived(before, after, capacity);
  const ev = evaluateDelivery(ordered, received, tolerance);
  const vehicleOk = normaliseVehicleNumber(vehicle);
  const stepLitres = Math.round(capacity * 0.005);

  async function submit() {
    setError(null);
    if (!vehicleOk) return setError('Enter the vehicle number like MH 12 AB 1234.');
    if (after <= before) return setError('After-unloading level must be higher than the before level.');
    try {
      let photoKey: string | null = null;
      if (file) {
        setStage('uploading');
        photoKey = await uploadCheckinPhoto(file);
      }
      setStage('saving');
      const r = await api<Result>('/guard/checkins', { body: { bookingId: booking.id, vehicleNumber: vehicleOk, levelBeforePct: before, levelAfterPct: after, photoKey } });
      onDone(r);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setStage('idle');
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onCancel} className="flex min-h-12 items-center gap-2 font-semibold text-primary"><Icon name="arrowLeft" /> Back to list</button>
      <div className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{booking.code}</h1>
          <a href={`tel:+91${booking.vendor_phone}`} className="flex min-h-12 items-center gap-1 rounded-lg px-3 font-semibold text-primary">Call vendor</a>
        </div>
        <div className="font-medium">{booking.vendor}</div>
        <div className="text-muted">Ordered <strong className="text-ink">{formatLitres(ordered)}</strong> into <strong className="text-ink">{tank?.name ?? 'tank'}</strong></div>
      </div>

      <div className="card space-y-5 p-4">
        <div>
          <label htmlFor="vehicle" className="label text-base">Vehicle number</label>
          <input
            id="vehicle"
            className="input h-14 font-display text-xl font-bold uppercase tracking-wider"
            placeholder="MH 12 AB 1234"
            autoComplete="off"
            autoCapitalize="characters"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value.toUpperCase())}
            onBlur={() => vehicleOk && setVehicle(vehicleOk)}
            aria-invalid={vehicle.length > 4 && !vehicleOk}
          />
          {vehicle.length > 4 && !vehicleOk && <p className="mt-1 text-sm text-danger">Format: MH 12 AB 1234</p>}
        </div>
        <LevelInput label="Level before unloading" value={before} onChange={setBefore} capacity={capacity} />
        <LevelInput label="Level after unloading" value={after} onChange={setAfter} capacity={capacity} />
        <p className="text-xs text-muted">Each 0.5% step = {formatLitres(stepLitres)} in this tank. Type a decimal (e.g. 46.3) for a precise reading.</p>

        <div className={cx('rounded-xl p-4', ev.isShort ? 'bg-warn-soft' : 'bg-ok-soft')} aria-live="polite">
          <div className="text-sm font-medium text-muted">Litres received</div>
          <div className={cx('font-display text-3xl font-bold num', ev.isShort ? 'text-warn' : 'text-ok')}>{formatLitres(received)}</div>
          <div className={cx('mt-1 font-semibold', ev.isShort ? 'text-warn' : 'text-ok')}>
            {ev.isShort
              ? `Short by ${formatLitres(ev.shortByLitres)} — committee will be alerted and the cost reduced.`
              : ev.shortfall > 0 ? `Within the ${formatLitres(tolerance)} tolerance.` : 'Full quantity received.'}
          </div>
        </div>

        <div>
          <span className="label text-base">Tanker / challan photo</span>
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-white px-4 font-semibold text-primary active:bg-page">
            <Icon name="camera" /> {file ? 'Retake photo' : 'Take photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          {preview && <img src={preview} alt="Selected tanker or challan" className="mt-2 max-h-56 w-full rounded-xl object-cover" />}
          <p className="mt-1 text-xs text-muted">Optional but recommended. Images only, max 5 MB.</p>
        </div>

        <ErrorBanner error={error} />
        <Button size="lg" className="h-14 w-full text-lg" busy={stage !== 'idle'} onClick={submit} disabled={!vehicle}>
          {stage === 'uploading' ? 'Uploading photo…' : stage === 'saving' ? 'Saving…' : 'Confirm check-in'}
        </Button>
      </div>
    </div>
  );
}

function ResultView({ result, onDone }: { result: Result; onDone: () => void }) {
  return (
    <div className="card space-y-3 p-6 text-center">
      <div className={cx('mx-auto grid h-16 w-16 place-items-center rounded-full', result.isShort ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
        <Icon name={result.isShort ? 'alert' : 'check'} size={32} />
      </div>
      <h1 className="text-2xl font-bold">{result.code} checked in</h1>
      <p className="text-lg num">{formatLitres(result.litresReceived)} of {formatLitres(result.litresOrdered)} received</p>
      {result.isShort && (
        <p className="rounded-xl bg-warn-soft p-3 font-semibold text-warn">
          Short by {formatLitres(result.shortByLitres)}. Committee alerted. Cost reduced from {formatINR(result.costPaise)} to {formatINR(result.finalCostPaise)}.
        </p>
      )}
      {!result.onTime && <p className="font-semibold text-warn">Marked late (after the delivery slot).</p>}
      <Button size="lg" className="h-14 w-full" onClick={onDone}>Done</Button>
    </div>
  );
}
