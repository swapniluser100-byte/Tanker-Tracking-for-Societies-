import { useState } from 'react';
import { Link } from 'react-router';
import { api, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { APPROVERS, BOOKING_MANAGERS } from '../../../shared/roles';
import { formatClock, formatDate, formatINR, formatLitres, formatMonth } from '../../../shared/format';
import { formatHours, type BookingRow, type MonthTotals, type MunicipalSummary, type TankStatus, type VendorStat } from '../../lib/types';
import { Button, Card, Chip, Empty, ErrorBanner, LinkButton, Loading, Segmented, Stat, StatusChip, Table, cx, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { LogSupplyModal, TankCard } from '../../components/water';
import { SpendChart } from '../../components/SpendChart';

interface Dashboard {
  society: { name: string; flatsCount: number; monthlyBudgetPaise: number; approvalLimitPaise: number; shortToleranceLitres: number };
  today: string;
  storage: { capacity: number; litres: number; pct: number; avgDailyUseLitres: number; hoursLeft: number | null };
  tanks: TankStatus[];
  month: MonthTotals & { ym: string; budgetPaise: number; costPerFlatPaise: number };
  spendSeries: { month: string; spentPaise: number; tankers: number }[];
  vendors: VendorStat[];
  mostReliableVendorId: number | null;
  municipal: MunicipalSummary;
  todayTankers: BookingRow[];
  alerts: { id: number; type: string; message: string; booking_id: number | null; created_at: string }[];
  pendingApprovals: number;
  openComplaints: number;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CommitteeDashboard() {
  const { data, error, loading, reload } = useApi<Dashboard>('/dashboard');
  const { user } = useAuth();
  const toast = useToast();
  const [logOpen, setLogOpen] = useState(false);
  const [lang, setLang] = useState<'en' | 'mr'>('en');
  const [sharing, setSharing] = useState(false);
  const canBook = user && BOOKING_MANAGERS.includes(user.role);
  const canApprove = user && APPROVERS.includes(user.role);

  if (loading && !data) return <Loading label="Loading dashboard…" />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;

  const low = data.tanks.filter((t) => t.isLow);
  const budgetUsedPct = data.month.budgetPaise ? (data.month.spentPaise / data.month.budgetPaise) * 100 : 0;
  const m = data.municipal;

  async function shareWhatsApp() {
    // Open the window synchronously so mobile browsers don't treat it as a popup.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setSharing(true);
    try {
      const r = await api<{ url: string }>(`/reports/whatsapp?key=daily_update&lang=${lang}`);
      if (win) win.location.href = r.url;
      else window.location.href = r.url;
    } catch (e) {
      win?.close();
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSharing(false);
    }
  }

  async function ack(id: number) {
    await api(`/alerts/${id}/ack`, { body: {} });
    void reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted">{formatDate(data.today)} · {formatMonth(data.month.ym)} so far</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Message language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'EN' }, { value: 'mr', label: 'मराठी' }]} />
          <Button variant="secondary" icon="whatsapp" busy={sharing} onClick={shareWhatsApp}>Send WhatsApp update</Button>
          <LinkButton href={`/api/reports/monthly.csv?month=${data.month.ym}`} icon="download" download>Monthly report</LinkButton>
        </div>
      </div>

      {/* Low tank banner */}
      {low.map((t) => (
        <div key={t.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-warn-accent bg-warn-soft px-4 py-3">
          <Icon name="alert" className="text-warn" size={24} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-warn">{t.name} is at {Math.round(t.levelPct ?? 0)}% — below the {t.alertPct}% alert level</div>
            <div className="text-sm text-warn">About {formatHours(t.hoursLeft)} of water left at the 7-day average use.</div>
          </div>
          {canBook && <Link to={`/app/book?tank=${t.type === 'sump' ? t.id : ''}`} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-warn px-4 font-semibold text-white hover:bg-[#7c2a0e]">Book now</Link>}
        </div>
      ))}

      {data.pendingApprovals > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-primary/30 bg-primary-soft px-4 py-3">
          <Icon name="rupee" className="text-primary" />
          <div className="flex-1 font-semibold text-primary-dark">{data.pendingApprovals} booking{data.pendingApprovals > 1 ? 's' : ''} above {formatINR(data.society.approvalLimitPaise)} waiting for treasurer approval</div>
          <Link to="/app/bookings?status=pending_approval" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline">{canApprove ? 'Review' : 'View'}</Link>
        </div>
      )}

      {data.alerts.length > 0 && (
        <Card title={`Alerts (${data.alerts.length})`}>
          <ul className="divide-y divide-line">
            {data.alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <Chip tone="orange">{a.type === 'short_delivery' ? 'Short delivery' : a.type === 'low_tank' ? 'Low tank' : 'Sensor'}</Chip>
                <span className="flex-1">{a.message}</span>
                <Button size="sm" variant="ghost" onClick={() => ack(a.id)}>Acknowledge</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="drop" label="Water stored now" value={formatLitres(data.storage.litres)} sub={`${Math.round(data.storage.pct)}% of ${formatLitres(data.storage.capacity)} · ~${formatHours(data.storage.hoursLeft)}`} />
        <Stat icon="truck" label="Tankers this month" value={`${data.month.tankers}`} sub={<>{formatLitres(data.month.litresReceived)} received · <span className={data.month.shortCount ? 'font-semibold text-warn' : ''}>{data.month.shortCount} short</span></>} />
        <Stat
          icon="rupee"
          label="Tanker spend vs budget"
          value={formatINR(data.month.spentPaise)}
          tone={budgetUsedPct > 100 ? 'warn' : 'default'}
          sub={<>of {formatINR(data.month.budgetPaise)} ({Math.round(budgetUsedPct)}%)<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-page ring-1 ring-line"><div className={cx('h-full', budgetUsedPct > 100 ? 'bg-warn-accent' : 'bg-ok')} style={{ width: `${Math.min(100, budgetUsedPct)}%` }} /></div></>}
        />
        <Stat icon="building" label="Cost per flat so far" value={formatINR(data.month.costPerFlatPaise)} sub={`${data.society.flatsCount} flats`} />
      </div>

      {/* Tanks */}
      <section aria-labelledby="tanks-h">
        <h2 id="tanks-h" className="mb-2 text-base font-semibold">Tank levels</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.tanks.map((t) => <TankCard key={t.id} tank={t} />)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Municipal supply */}
        <Card title="Municipal supply" action={<Button size="sm" variant="secondary" onClick={() => setLogOpen(true)}>Log today's supply</Button>}>
          <div className="mb-3 rounded-xl bg-primary-soft p-3">
            <div className="text-sm text-primary-dark">Next {m.next?.authority ?? 'PMC'} slot</div>
            <div className="font-display text-lg font-bold text-primary-dark">
              {m.next ? `${m.next.date === data.today ? 'Today' : WD[m.next.weekday]} ${formatClock(m.next.startTime)} – ${formatClock(m.next.endTime)}` : 'No schedule set'}
            </div>
            {m.todayLog && (
              <div className={cx('mt-1 text-sm font-semibold', m.todayLog.came ? 'text-ok' : 'text-warn')}>
                Today: {m.todayLog.came ? `came at ${formatClock(m.todayLog.actualStart ?? '00:00')}${m.todayLog.delayMinutes ? ` (${m.todayLog.delayMinutes} min late)` : ''}` : 'did not come'}
              </div>
            )}
          </div>
          <ol className="mb-3 grid grid-cols-7 gap-1 text-center" aria-label="Supply days this week">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(`${data.today}T12:00:00+05:30`);
              d.setUTCDate(d.getUTCDate() + i);
              const wd = d.getUTCDay();
              const slot = m.week.find((s) => s.weekday === wd);
              return (
                <li key={i} className={cx('rounded-lg py-1.5 text-xs', slot ? 'bg-primary text-white' : 'bg-page text-muted', i === 0 && 'ring-2 ring-ink/70')}>
                  <div className="font-semibold">{WD[wd]}</div>
                  <div>{slot ? formatClock(slot.startTime).replace(':00', '').replace(' ', '') : '—'}</div>
                  <span className="sr-only">{slot ? 'supply day' : 'no supply'}</span>
                </li>
              );
            })}
          </ol>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Came (last 30 days)</dt><dd className="text-lg font-semibold num">{m.cameRatePct == null ? '—' : `${Math.round(m.cameRatePct)}%`}</dd></div>
            <div><dt className="text-muted">Average delay</dt><dd className="text-lg font-semibold num">{m.avgDelayMinutes == null ? '—' : `${Math.round(m.avgDelayMinutes)} min`}</dd></div>
          </dl>
        </Card>

        {/* Today's tankers */}
        <Card className="lg:col-span-2" title="Today's tankers" action={<Link to="/app/bookings" className="text-sm font-semibold text-primary">All bookings</Link>}>
          {!data.todayTankers.length ? <Empty icon="truck">No tankers booked for today.</Empty> : (
            <Table label="Today's tankers">
              <thead><tr><th className="th">Slot</th><th className="th">Vendor</th><th className="th">Vehicle</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Cost</th><th className="th">Status</th></tr></thead>
              <tbody>
                {data.todayTankers.map((b) => (
                  <tr key={b.id}>
                    <td className="td whitespace-nowrap">{b.start_time ? formatClock(b.start_time) : '—'}<div className="text-xs text-muted">{b.code}</div></td>
                    <td className="td">{b.vendor}</td>
                    <td className="td whitespace-nowrap">{b.vehicle_number ?? '—'}</td>
                    <td className="td text-right num">{formatLitres(b.size_litres * b.count)}</td>
                    <td className="td text-right num">{b.litres_received == null ? '—' : formatLitres(b.litres_received)}</td>
                    <td className="td text-right num">{formatINR(b.final_cost_paise ?? b.cost_paise)}</td>
                    <td className="td"><StatusChip status={b.status} shortBy={b.short_by_litres} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tanker spend — last 6 months">
          <SpendChart data={data.spendSeries} budgetPaise={data.society.monthlyBudgetPaise} />
        </Card>
        <Card title="Vendor scorecard" action={<Link to="/app/vendors" className="text-sm font-semibold text-primary">Details</Link>}>
          <Table label="Vendor scorecard">
            <thead><tr><th className="th">Vendor</th><th className="th text-right">Rate / 10k L</th><th className="th text-right">On time</th><th className="th text-right">Short</th></tr></thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.id}>
                  <td className="td">
                    <div className="font-semibold">{v.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted">{v.trips} trips{v.id === data.mostReliableVendorId && <Chip tone="green">Most reliable</Chip>}</div>
                  </td>
                  <td className="td text-right num">{formatINR(v.ratePer10kPaise)}</td>
                  <td className={cx('td text-right num', (v.onTimePct ?? 100) < 80 && 'font-semibold text-warn')}>{v.onTimePct == null ? '—' : `${Math.round(v.onTimePct)}%`}</td>
                  <td className={cx('td text-right num', (v.shortPct ?? 0) > 10 && 'font-semibold text-warn')}>{v.shortCount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <LogSupplyModal open={logOpen} onClose={() => setLogOpen(false)} onSaved={reload} />
    </div>
  );
}
