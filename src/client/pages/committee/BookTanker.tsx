import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BOOKING_MANAGERS } from '../../../shared/roles';
import { bookingCostPaise, costPerFlatPaise, wouldOverflow } from '../../../shared/calc';
import { addDays, formatClock, formatDate, formatINR, formatLitres, istTime } from '../../../shared/format';
import type { MonthTotals, TankStatus, VendorStat } from '../../lib/types';
import { Button, Card, Chip, ErrorBanner, Field, Loading, PageHeader, cx } from '../../components/ui';
import { Icon } from '../../components/icons';

interface Options {
  sizes: { id: number; litres: number; label: string }[];
  slots: { id: number; label: string; startTime: string; endTime: string }[];
  tanks: TankStatus[];
  vendors: VendorStat[];
  mostReliableVendorId: number | null;
  society: { flatsCount: number; monthlyBudgetPaise: number; approvalLimitPaise: number };
  month: MonthTotals;
  today: string;
}

interface Created { booking: { id: number; code: string; status: string; date: string }; needsApproval: boolean }

export default function BookTanker() {
  const { data, error, loading, reload } = useApi<Options>('/bookings/options');
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [date, setDate] = useState('');
  const [tankId, setTankId] = useState<number | null>(null);
  const [slotId, setSlotId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  // Sensible defaults once options load: standard size, sump (or the tank from the low-level banner), most reliable vendor.
  useEffect(() => {
    if (!data) return;
    setDate((d) => d || data.today);
    setSizeId((s) => s ?? (data.sizes.find((z) => z.litres === 10000) ?? data.sizes[0])?.id ?? null);
    const fromQuery = Number(params.get('tank'));
    setTankId((t) => t ?? (data.tanks.find((x) => x.id === fromQuery) ?? data.tanks.find((x) => x.type === 'sump') ?? data.tanks[0])?.id ?? null);
    setVendorId((v) => v ?? data.mostReliableVendorId ?? data.vendors[0]?.id ?? null);
  }, [data, params]);

  const size = data?.sizes.find((s) => s.id === sizeId);
  const tank = data?.tanks.find((t) => t.id === tankId);
  const slot = data?.slots.find((s) => s.id === slotId);
  const vendor = data?.vendors.find((v) => v.id === vendorId);
  const litres = (size?.litres ?? 0) * count;
  const total = vendor && size ? bookingCostPaise(vendor.ratePer10kPaise, size.litres, count) : 0;
  const isToday = date === data?.today;
  const nowTime = istTime();

  // A slot that has already ended today can't be booked.
  useEffect(() => {
    if (slot && isToday && slot.endTime <= nowTime) setSlotId(null);
  }, [slot, isToday, nowTime]);

  const summary = useMemo(() => {
    if (!data) return null;
    const budgetLeft = data.society.monthlyBudgetPaise - data.month.spentPaise - data.month.committedPaise - total;
    return { budgetLeft, perFlat: costPerFlatPaise(total, data.society.flatsCount), needsApproval: total > data.society.approvalLimitPaise };
  }, [data, total]);

  if (user && !BOOKING_MANAGERS.includes(user.role)) {
    return <ErrorBanner error="Only committee admins can book tankers. Treasurers approve bookings from the Tanker bookings page." />;
  }
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data || !summary) return null;

  const overflow = tank && tank.litres != null && wouldOverflow(tank.litres, litres, tank.capacityLitres);
  const canSubmit = Boolean(size && tank && slot && vendor && date);

  async function confirm() {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await api<Created>('/bookings', { body: { vendorId, sizeId, count, date, slotId, targetTankId: tankId, notes: notes || null } });
      setCreated(r);
      void reload();
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto max-w-lg">
        <Card className="text-center">
          <div className={cx('mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full', created.needsApproval ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
            <Icon name={created.needsApproval ? 'clock' : 'check'} size={28} />
          </div>
          <h1 className="text-2xl font-bold">{created.booking.code}</h1>
          <p className="mt-1 text-muted">{vendor?.name} · {formatLitres(litres)} · {formatDate(created.booking.date)} {slot && `· ${formatClock(slot.startTime)}`}</p>
          <p className={cx('mt-3 font-semibold', created.needsApproval ? 'text-warn' : 'text-ok')}>
            {created.needsApproval
              ? `Above the ${formatINR(data.society.approvalLimitPaise)} limit — sent to the treasurer for approval.`
              : "Confirmed. It is on the security guard's list for check-in."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => { setCreated(null); setNotes(''); setCount(1); }}>Book another</Button>
            <Link to="/app/bookings" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-primary px-4 font-semibold text-white">View bookings</Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Book a tanker" subtitle="Choose size, slot and vendor. The total updates as you go." />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card title="1. Tanker size and quantity">
            <div role="radiogroup" aria-label="Tanker size" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.sizes.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={sizeId === s.id} onClick={() => setSizeId(s.id)}
                  className={cx('min-h-16 rounded-xl border-2 p-3 text-left transition-colors', sizeId === s.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
                  <div className="font-display text-lg font-bold num">{formatLitres(s.litres)}</div>
                  <div className="text-xs text-muted">{s.label.replace(/^[\d,]+ L\s*/, '').replace(/[()]/g, '') || 'tanker'}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <span className="font-semibold" id="count-label">Number of tankers</span>
              <div className="flex items-center gap-1" role="group" aria-labelledby="count-label">
                <button type="button" className="grid h-11 w-11 place-items-center rounded-lg border border-line-strong disabled:opacity-40" aria-label="One fewer tanker" disabled={count <= 1} onClick={() => setCount(count - 1)}><Icon name="minus" /></button>
                <output className="w-10 text-center font-display text-xl font-bold num" aria-live="polite">{count}</output>
                <button type="button" className="grid h-11 w-11 place-items-center rounded-lg border border-line-strong disabled:opacity-40" aria-label="One more tanker" disabled={count >= 5} onClick={() => setCount(count + 1)}><Icon name="plus" /></button>
              </div>
              <span className="text-muted num">= {formatLitres(litres)}</span>
            </div>
          </Card>

          <Card title="2. When and where">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Delivery date">
                {(id) => <input id={id} type="date" className="input" min={data.today} max={addDays(data.today, 30)} value={date} onChange={(e) => setDate(e.target.value)} />}
              </Field>
              <Field label="Target tank">
                {(id) => (
                  <select id={id} className="input" value={tankId ?? ''} onChange={(e) => setTankId(Number(e.target.value))}>
                    {data.tanks.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.levelPct == null ? 'no reading' : `${Math.round(t.levelPct)}% (${formatLitres(t.litres ?? 0)})`}</option>)}
                  </select>
                )}
              </Field>
            </div>
            {overflow && tank && (
              <div role="alert" className="mt-3 flex gap-2 rounded-xl border border-warn-accent/60 bg-warn-soft p-3 text-sm text-warn">
                <Icon name="alert" />
                <span><strong>May overflow:</strong> {tank.name} has {formatLitres(tank.litres ?? 0)} of {formatLitres(tank.capacityLitres)}; only {formatLitres(tank.capacityLitres - (tank.litres ?? 0))} of space for {formatLitres(litres)}. Consider fewer tankers or a later date.</span>
              </div>
            )}
            <div className="mt-4">
              <div className="label" id="slot-label">Delivery slot</div>
              <div role="radiogroup" aria-labelledby="slot-label" className="flex flex-wrap gap-2">
                {data.slots.map((s) => {
                  const past = isToday && s.endTime <= nowTime;
                  return (
                    <button key={s.id} type="button" role="radio" aria-checked={slotId === s.id} disabled={past} onClick={() => setSlotId(s.id)}
                      className={cx('min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40', slotId === s.id ? 'border-primary bg-primary text-white' : 'border-line-strong bg-white hover:border-primary')}>
                      {formatClock(s.startTime)} – {formatClock(s.endTime)}
                      <span className="sr-only"> {s.label}{past ? ' (already over)' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card title="3. Vendor">
            <div role="radiogroup" aria-label="Vendor" className="grid gap-2 sm:grid-cols-2">
              {data.vendors.map((v) => {
                const best = v.id === data.mostReliableVendorId;
                const cost = size ? bookingCostPaise(v.ratePer10kPaise, size.litres, count) : 0;
                return (
                  <button key={v.id} type="button" role="radio" aria-checked={vendorId === v.id} onClick={() => setVendorId(v.id)}
                    className={cx('relative rounded-xl border-2 p-3 text-left transition-colors', vendorId === v.id ? 'border-primary bg-primary-soft' : best ? 'border-ok/50 hover:border-ok' : 'border-line hover:border-line-strong')}>
                    {best && <span className="absolute right-2 top-2"><Chip tone="green">★ Most reliable</Chip></span>}
                    <div className="pr-28 font-semibold">{v.name}</div>
                    <div className="text-sm text-muted">{v.area} · {formatINR(v.ratePer10kPaise)} / 10,000 L</div>
                    <dl className="mt-2 grid grid-cols-3 gap-1 text-sm">
                      <div><dt className="text-xs text-muted">On time</dt><dd className={cx('font-semibold num', (v.onTimePct ?? 100) < 80 && 'text-warn')}>{v.onTimePct == null ? '—' : `${Math.round(v.onTimePct)}%`}</dd></div>
                      <div><dt className="text-xs text-muted">Short</dt><dd className={cx('font-semibold num', (v.shortPct ?? 0) > 10 && 'text-warn')}>{v.shortCount}</dd></div>
                      <div><dt className="text-xs text-muted">Trips</dt><dd className="font-semibold num">{v.trips}</dd></div>
                    </dl>
                    <div className="mt-2 font-display font-bold num">{formatINR(cost)}</div>
                  </button>
                );
              })}
            </div>
            <Field label="Note for vendor / guard (optional)" className="mt-3">
              {(id) => <input id={id} className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. use gate 2" />}
            </Field>
          </Card>
        </div>

        {/* Live summary */}
        <aside aria-label="Booking summary" className="lg:sticky lg:top-32 lg:self-start">
          <Card title="Summary">
            <dl className="space-y-2 text-sm">
              <Row label="Vendor" value={vendor?.name ?? '—'} />
              <Row label="Quantity" value={`${count} × ${size ? formatLitres(size.litres) : '—'} = ${formatLitres(litres)}`} />
              <Row label="Date" value={date ? formatDate(date) : '—'} />
              <Row label="Slot" value={slot ? `${formatClock(slot.startTime)} – ${formatClock(slot.endTime)}` : <span className="text-warn">Choose a slot</span>} />
              <Row label="Into" value={tank?.name ?? '—'} />
            </dl>
            <div className="my-3 border-t border-line" />
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-display text-2xl font-bold num">{formatINR(total)}</span>
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              <Row label="Cost per flat" value={formatINR(summary.perFlat)} />
              <Row label="Budget left after this" value={<span className={summary.budgetLeft < 0 ? 'font-semibold text-warn' : ''}>{formatINR(summary.budgetLeft)}</span>} />
            </dl>
            {summary.needsApproval && (
              <p className="mt-3 rounded-lg bg-warn-soft p-2 text-sm font-medium text-warn">Above {formatINR(data.society.approvalLimitPaise)} — needs treasurer approval before the vendor is called.</p>
            )}
            <ErrorBanner error={submitError} />
            <Button size="lg" className="mt-3 w-full" busy={busy} disabled={!canSubmit} onClick={confirm}>
              {summary.needsApproval ? 'Send for approval' : 'Confirm booking'}
            </Button>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium num">{value}</dd>
    </div>
  );
}
