import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useLang } from '../../lib/i18n';
import { formatDateTime, formatINR, formatLitres, formatMonth, istTime } from '../../../shared/format';
import type { MonthTotals, MunicipalLog, MunicipalSlot } from '../../lib/types';
import { Button, ErrorBanner, FillBar, Loading, Modal, cx, useToast } from '../../components/ui';
import { Icon, type IconName } from '../../components/icons';

type L = ReturnType<typeof useLang>;

interface Notice { id: number; title: string; titleMr: string | null; body: string; bodyMr: string | null; priority: 'info' | 'important' | 'urgent'; createdAt: string }
interface Home {
  flat: { label: string; wing: string } | null;
  society: { name: string; area: string };
  water: { on: boolean; until: string | null; nextStart: string | null; nextIsTomorrow?: boolean; tankEmpty: boolean };
  overhead: { name: string; levelPct: number | null; hoursLeft: number | null; isLow: boolean } | null;
  releaseTimings: { start: string; end: string }[];
  municipal: { today: MunicipalSlot[]; todayLog: MunicipalLog | null; next: MunicipalSlot | null };
  tankers: { code: string; status: string; count: number; size_litres: number; eta_at: string | null; start_time: string | null; end_time: string | null }[];
  myShare: { month: MonthTotals; perFlatPaise: number };
  notices: Notice[];
}

/** Installable mobile web app for residents, in English and Marathi. */
export default function ResidentApp() {
  const l = useLang();
  const { t, lang, setLang } = l;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as Event & { prompt: () => Promise<void> }); };
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const tabs: { to: string; label: string; icon: IconName }[] = [
    { to: '/resident', label: t('navWater'), icon: 'drop' },
    { to: '/resident/schedule', label: t('navSchedule'), icon: 'calendar' },
    { to: '/resident/costs', label: t('navCosts'), icon: 'rupee' },
    { to: '/resident/notices', label: t('navNotices'), icon: 'bell' },
  ];

  return (
    <div lang={lang} className={cx('min-h-dvh bg-page pb-24', lang === 'mr' && 'font-deva')}>
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <div className="font-display text-lg font-bold text-primary">{t('appName')}</div>
            <div className="truncate text-xs text-muted">{user?.flat ? t('flat', { flat: user.flat }) : user?.name}</div>
          </div>
          <div className="flex items-center gap-1">
            {installEvt && (
              <button type="button" className="min-h-11 rounded-lg px-2 text-sm font-semibold text-primary" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }} title={t('installHint')}>
                {t('installApp')}
              </button>
            )}
            <button type="button" onClick={() => setLang(lang === 'en' ? 'mr' : 'en')} className="flex min-h-11 items-center gap-1 rounded-lg border border-line-strong px-3 font-semibold" aria-label={t('switchLangLabel')} lang={lang === 'en' ? 'mr' : 'en'}>
              <Icon name="language" size={18} /> {t('switchLang')}
            </button>
            <button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-muted" aria-label={t('signOut')} onClick={async () => { await logout(); navigate('/login'); }}>
              <Icon name="logout" />
            </button>
          </div>
        </div>
        {!online && <div className="bg-warn-soft px-4 py-1.5 text-center text-sm font-medium text-warn" role="status">{t('offline')}</div>}
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4">
        <Routes>
          <Route index element={<WaterView l={l} />} />
          <Route path="schedule" element={<ScheduleView l={l} />} />
          <Route path="costs" element={<CostsView l={l} />} />
          <Route path="notices" element={<NoticesView l={l} />} />
        </Routes>
      </main>

      <nav aria-label={t('appName')} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink to={tab.to} end className={({ isActive }) => cx('flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold', isActive ? 'text-primary' : 'text-muted')}>
                {({ isActive }) => (
                  <>
                    <span className={cx('grid h-8 w-14 place-items-center rounded-full', isActive && 'bg-primary-soft')}><Icon name={tab.icon} size={22} /></span>
                    {tab.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function WaterView({ l }: { l: L }) {
  const { t, clock, weekdays, lang } = l;
  const { data, error, loading, reload } = useApi<Home>('/resident/home');
  const [report, setReport] = useState<'no_water' | 'leakage' | null>(null);

  if (loading && !data) return <Loading label={t('loading')} />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const { water, overhead, municipal } = data;
  const onTheWay = data.tankers.find((x) => x.status === 'on_the_way');
  const nextTanker = onTheWay ?? data.tankers[0];
  const etaTime = (iso: string) => clock(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)));

  return (
    <div className="space-y-4">
      {/* Water ON/OFF */}
      <section className={cx('rounded-[var(--radius-card)] p-5 text-white', water.on ? 'bg-ok' : 'bg-[#334155]')} aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm opacity-90">{data.flat ? t('wing', { wing: data.flat.wing }) : data.society.name}</div>
            <div className="font-display text-3xl font-bold">{water.on ? t('waterOn') : t('waterOff')}</div>
            <div className="mt-1 text-base font-medium opacity-95">
              {water.on && water.until ? t('until', { time: clock(water.until) }) : water.nextStart ? t(water.nextIsTomorrow ? 'nextOnTomorrow' : 'nextOnToday', { time: clock(water.nextStart) }) : ''}
            </div>
          </div>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-white/15"><Icon name="drop" size={34} /></div>
        </div>
        {water.tankEmpty && <p className="mt-2 rounded-lg bg-white/15 p-2 text-sm">{t('tankEmpty')}</p>}
      </section>

      {/* Overhead tank */}
      {overhead && (
        <section className={cx('card p-4', overhead.isLow && 'border-warn-accent bg-warn-soft')}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">{t('overheadTank')}</h2>
            <span className={cx('font-display text-2xl font-bold num', overhead.isLow && 'text-warn')}>{overhead.levelPct == null ? '—' : `${Math.round(overhead.levelPct)}%`}</span>
          </div>
          <FillBar pct={overhead.levelPct} low={overhead.isLow} label={t('overheadTank')} />
          {overhead.hoursLeft != null && <p className={cx('mt-2 text-sm', overhead.isLow ? 'font-semibold text-warn' : 'text-muted')}>{t('hoursLeft', { h: Math.max(1, Math.round(overhead.hoursLeft)) })}</p>}
          {overhead.isLow && <p className="text-sm font-semibold text-warn">{t('lowWarning')}</p>}
        </section>
      )}

      {/* Tanker on the way */}
      {nextTanker && (
        <section className={cx('card flex items-center gap-3 p-4', onTheWay && 'border-primary bg-primary-soft')}>
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-white"><Icon name="truck" size={26} /></div>
          <div>
            <h2 className="font-semibold">{onTheWay ? t('tankerOnTheWay') : t('tankerScheduled', { time: nextTanker.start_time ? clock(nextTanker.start_time) : '' })}</h2>
            <p className="text-sm text-muted num">
              {formatLitres(nextTanker.size_litres * nextTanker.count)}
              {onTheWay?.eta_at && ` · ${t('tankerEta', { time: etaTime(onTheWay.eta_at) })}`}
            </p>
          </div>
        </section>
      )}

      {/* Today's timings */}
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">{t('todaysTimings')}</h2>
        <ul className="space-y-2">
          {data.releaseTimings.map((w) => {
            const now = istTime();
            const active = w.start <= now && now < w.end;
            return (
              <li key={w.start} className={cx('flex items-center justify-between rounded-lg px-3 py-2', active ? 'bg-ok-soft font-semibold text-ok' : 'bg-page')}>
                <span>{t('releaseWindow')}</span>
                <span className="num">{clock(w.start)} – {clock(w.end)}</span>
              </li>
            );
          })}
          <li className={cx('rounded-lg px-3 py-2', municipal.todayLog && !municipal.todayLog.came ? 'bg-warn-soft font-semibold text-warn' : 'bg-page')}>
            {municipal.todayLog
              ? municipal.todayLog.came
                ? t('pmcCame', { authority: municipal.today[0]?.authority ?? 'PMC', time: clock(municipal.todayLog.actualStart ?? '00:00') })
                : t('pmcNotCame')
              : municipal.today.length
                ? `${t('pmcSupply', { authority: municipal.today[0].authority })}: ${clock(municipal.today[0].startTime)} – ${clock(municipal.today[0].endTime)}`
                : t('pmcNotToday')}
            {(!municipal.today.length || (municipal.todayLog && !municipal.todayLog.came)) && municipal.next && (
              <div className="text-sm font-normal text-muted">{t('pmcNext', { day: weekdays[municipal.next.weekday], time: clock(municipal.next.startTime) })}</div>
            )}
          </li>
        </ul>
      </section>

      {/* My share */}
      <section className="card p-4">
        <h2 className="text-sm font-medium text-muted">{t('myShare')}</h2>
        <div className="font-display text-3xl font-bold num">{formatINR(data.myShare.perFlatPaise)}</div>
        <p className="text-sm text-muted">{t('perFlatSoFar')} · {t('tankersThisMonth', { n: data.myShare.month.tankers, litres: formatLitres(data.myShare.month.litresReceived) })}</p>
      </section>

      {/* Report buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setReport('no_water')} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border-2 border-warn/30 bg-white p-3 font-semibold text-warn active:bg-warn-soft">
          <Icon name="drop" /> {t('reportNoWater')}
        </button>
        <button type="button" onClick={() => setReport('leakage')} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border-2 border-primary/30 bg-white p-3 font-semibold text-primary active:bg-primary-soft">
          <Icon name="leak" /> {t('reportLeakage')}
        </button>
      </div>

      {/* Notices preview */}
      {data.notices.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t('notices')}</h2>
            <NavLink to="/resident/notices" className="flex min-h-11 items-center text-sm font-semibold text-primary">{t('seeAll')}</NavLink>
          </div>
          <ul className="space-y-2">
            {data.notices.map((n) => <NoticeItem key={n.id} n={n} lang={lang} compact />)}
          </ul>
        </section>
      )}

      <ReportModal type={report} onClose={() => setReport(null)} l={l} />
    </div>
  );
}

function ReportModal({ type, onClose, l }: { type: 'no_water' | 'leakage' | null; onClose: () => void; l: L }) {
  const { t } = l;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  async function send() {
    if (!type) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ duplicate?: boolean }>('/resident/complaints', { body: { type, description: text || null } });
      toast(r.duplicate ? t('alreadyReported') : t('reported'));
      setText('');
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={Boolean(type)} onClose={onClose} title={type === 'leakage' ? t('reportTitleLeakage') : t('reportTitleNoWater')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button busy={busy} onClick={send}>{t('send')}</Button></>}>
      <ErrorBanner error={err} />
      <label htmlFor="report-text" className="label">{t('reportDetails')}</label>
      <textarea id="report-text" className="input min-h-24" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={type === 'leakage' ? t('reportPlaceholderLeakage') : t('reportPlaceholderNoWater')} />
    </Modal>
  );
}

function NoticeItem({ n, lang, compact }: { n: Notice; lang: 'en' | 'mr'; compact?: boolean }) {
  const title = lang === 'mr' && n.titleMr ? n.titleMr : n.title;
  const body = lang === 'mr' && n.bodyMr ? n.bodyMr : n.body;
  return (
    <li className={cx('rounded-xl border p-3', n.priority === 'urgent' ? 'border-warn-accent bg-warn-soft' : 'border-line bg-white')}>
      <h3 className={cx('font-semibold', n.priority === 'urgent' && 'text-warn')}>
        {n.priority === 'urgent' && <Icon name="alert" size={16} className="mr-1 inline align-[-2px]" />}
        {title}
      </h3>
      <p className={cx('mt-0.5 text-sm', compact && 'line-clamp-2')}>{body}</p>
      <div className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt)}</div>
    </li>
  );
}

function ScheduleView({ l }: { l: L }) {
  const { t, clock, weekdays } = l;
  const { data, error, loading, reload } = useApi<{ releaseTimings: { start: string; end: string }[]; municipal: { week: MunicipalSlot[]; recentLogs: MunicipalLog[]; cameRatePct: number | null; avgDelayMinutes: number | null } }>('/resident/schedule');
  if (loading && !data) return <Loading label={t('loading')} />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    return { date, slots: data.municipal.week.filter((s) => s.date === date), weekday: new Date(`${date}T12:00:00+05:30`).getUTCDay() };
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('scheduleTitle')}</h1>
      <section className="card p-4">
        <h2 className="font-semibold">{t('releaseTimings')}</h2>
        <p className="mb-2 text-sm text-muted">{t('releaseHint')}</p>
        <ul className="space-y-1">
          {data.releaseTimings.map((w) => <li key={w.start} className="rounded-lg bg-page px-3 py-2 font-semibold num">{clock(w.start)} – {clock(w.end)}</li>)}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">{t('pmcThisWeek')}</h2>
        <ul className="divide-y divide-line">
          {days.map((d, i) => (
            <li key={d.date} className="flex items-center justify-between py-2.5">
              <span className="font-medium">{i === 0 ? t('today') : i === 1 ? t('tomorrow') : weekdays[d.weekday]}</span>
              {d.slots.length ? (
                <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-dark">{d.slots[0].authority} · {clock(d.slots[0].startTime)} – {clock(d.slots[0].endTime)}</span>
              ) : <span className="text-sm text-muted">{t('noSupply')}</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">{t('recentSupply')}</h2>
        {data.municipal.cameRatePct != null && (
          <p className="mb-2 text-sm text-muted">{t('reliability', { pct: Math.round(data.municipal.cameRatePct), delay: Math.round(data.municipal.avgDelayMinutes ?? 0) })}</p>
        )}
        <ul className="divide-y divide-line">
          {data.municipal.recentLogs.map((g) => (
            <li key={g.date} className="flex items-center justify-between py-2 text-sm">
              <span>{weekdays[new Date(`${g.date}T12:00:00+05:30`).getUTCDay()]} {g.date.slice(8)}/{g.date.slice(5, 7)}</span>
              {g.came ? (
                <span className="font-semibold text-ok">{t('came')} {clock(g.actualStart ?? '00:00')} · {g.delayMinutes ? t('minLate', { n: g.delayMinutes }) : t('onTime')}</span>
              ) : <span className="font-semibold text-warn">{t('didNotCome')}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CostsView({ l }: { l: L }) {
  const { t } = l;
  const { data, error, loading, reload } = useApi<{ flatsCount: number; month: MonthTotals & { perFlatPaise: number }; series: { month: string; spentPaise: number; tankers: number; perFlatPaise: number }[] }>('/resident/costs');
  if (loading && !data) return <Loading label={t('loading')} />;
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const max = Math.max(1, ...data.series.map((s) => s.perFlatPaise));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('costsTitle')}</h1>
      <section className="card p-4">
        <h2 className="text-sm font-medium text-muted">{t('yourShare')}</h2>
        <div className="font-display text-4xl font-bold num">{formatINR(data.month.perFlatPaise)}</div>
        <p className="mt-1 text-sm text-muted">{t('splitAcross', { n: data.flatsCount })}</p>
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-sm text-muted">{t('societySpend')}</div>
          <div className="text-lg font-semibold num">{formatINR(data.month.spentPaise)}</div>
          <div className="text-sm text-muted">{t('tankersThisMonth', { n: data.month.tankers, litres: formatLitres(data.month.litresReceived) })}</div>
        </div>
      </section>
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">{t('last6')}</h2>
        <table className="w-full text-sm">
          <thead className="sr-only"><tr><th>{t('month')}</th><th>{t('share')}</th><th>{t('tankers')}</th></tr></thead>
          <tbody>
            {data.series.map((s) => (
              <tr key={s.month}>
                <td className="w-20 py-1.5 pr-2 text-muted">{formatMonth(s.month)}</td>
                <td className="py-1.5">
                  <div className="h-3 rounded bg-primary" style={{ width: `${Math.max(2, (s.perFlatPaise / max) * 100)}%` }} aria-hidden="true" />
                </td>
                <td className="w-20 py-1.5 pl-2 text-right font-semibold num">{formatINR(s.perFlatPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function NoticesView({ l }: { l: L }) {
  const { t, lang } = l;
  const notices = useApi<{ notices: Notice[] }>('/resident/notices');
  const mine = useApi<{ complaints: { id: number; type: string; description: string | null; status: 'open' | 'in_progress' | 'resolved'; createdAt: string }[] }>('/resident/complaints');
  const statusText = { open: t('statusOpen'), in_progress: t('statusInProgress'), resolved: t('statusResolved') };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('notices')}</h1>
      <ErrorBanner error={notices.error} onRetry={notices.reload} />
      {notices.loading && !notices.data && <Loading label={t('loading')} />}
      {notices.data && (notices.data.notices.length ? (
        <ul className="space-y-3">{notices.data.notices.map((n) => <NoticeItem key={n.id} n={n} lang={lang} />)}</ul>
      ) : <p className="text-muted">{t('noNotices')}</p>)}
      {!!mine.data?.complaints.length && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">{t('myReports')}</h2>
          <ul className="divide-y divide-line">
            {mine.data.complaints.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{c.type === 'leakage' ? t('reportLeakage') : t('reportNoWater')} <span className="text-muted">· {formatDateTime(c.createdAt)}</span></span>
                <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', c.status === 'resolved' ? 'bg-ok-soft text-ok' : c.status === 'in_progress' ? 'bg-primary-soft text-primary-dark' : 'bg-warn-soft text-warn')}>{statusText[c.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
