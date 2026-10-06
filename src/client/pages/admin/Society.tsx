import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { Button, Card, ErrorBanner, Field, Loading, PageHeader, useToast } from '../../components/ui';

interface SocietyRes {
  society: {
    name: string; area: string; city: string; flatsCount: number; monthlyBudgetPaise: number; approvalLimitPaise: number;
    shortToleranceLitres: number; lowAlertPct: number;
  };
  releaseTimings: { start: string; end: string }[];
}

export default function AdminSociety() {
  const { data, error, loading, reload } = useApi<SocietyRes>('/admin/society');
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [timings, setTimings] = useState<{ start: string; end: string }[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const s = data.society;
    setF({
      name: s.name, area: s.area, city: s.city, flatsCount: String(s.flatsCount),
      budget: String(s.monthlyBudgetPaise / 100), approval: String(s.approvalLimitPaise / 100),
      tolerance: String(s.shortToleranceLitres), lowAlert: String(s.lowAlertPct),
    });
    setTimings(data.releaseTimings);
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      await api('/admin/society', {
        method: 'PUT',
        body: {
          name: f.name, area: f.area, city: f.city, flatsCount: Number(f.flatsCount),
          monthlyBudgetPaise: Math.round(Number(f.budget) * 100), approvalLimitPaise: Math.round(Number(f.approval) * 100),
          shortToleranceLitres: Number(f.tolerance), lowAlertPct: Number(f.lowAlert), releaseTimings: timings,
        },
      });
      toast('Society settings saved');
      void reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id, d) => <input id={id} aria-describedby={d} className="input" required value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />}
    </Field>
  );

  return (
    <>
      <PageHeader title="Society settings" subtitle="Budget, approval rules and alert thresholds used across the app" />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <form onSubmit={save} className="space-y-4">
          <ErrorBanner error={saveError} />
          <Card title="Society">
            <div className="grid gap-3 sm:grid-cols-2">
              {input('name', 'Society name')}
              {input('area', 'Area', {}, 'e.g. Wagholi, Hinjewadi, Baner, Kharadi')}
              {input('city', 'City')}
              {input('flatsCount', 'Number of flats', { type: 'number', min: 1, inputMode: 'numeric' }, 'Used for cost per flat')}
            </div>
          </Card>
          <Card title="Money & approvals">
            <div className="grid gap-3 sm:grid-cols-2">
              {input('budget', 'Monthly water budget (₹)', { type: 'number', min: 0, step: 1, inputMode: 'numeric' })}
              {input('approval', 'Treasurer approval limit (₹)', { type: 'number', min: 0, step: 1, inputMode: 'numeric' }, 'Bookings above this need treasurer approval (default ₹5,000)')}
            </div>
          </Card>
          <Card title="Deliveries & alerts">
            <div className="grid gap-3 sm:grid-cols-2">
              {input('tolerance', 'Short-delivery tolerance (litres)', { type: 'number', min: 0, inputMode: 'numeric' }, 'Shortfalls above this are flagged and the cost is pro-rated (default 300 L)')}
              {input('lowAlert', 'Default low-level alert (%)', { type: 'number', min: 5, max: 90, inputMode: 'numeric' }, 'Used for new tanks (default 30%). Each tank can override it.')}
            </div>
          </Card>
          <Card title="Water release timings" action={timings.length < 6 && <Button size="sm" variant="secondary" icon="plus" onClick={() => setTimings([...timings, { start: '06:00', end: '09:00' }])}>Add timing</Button>}>
            <p className="-mt-1 mb-3 text-sm text-muted">When water is released from the overhead tanks to flats. Residents see "Water ON until …" based on these.</p>
            <div className="space-y-2">
              {timings.map((t, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Field label={`Window ${i + 1} from`}>{(id) => <input id={id} type="time" className="input w-36" value={t.start} onChange={(e) => setTimings(timings.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />}</Field>
                  <Field label="to">{(id) => <input id={id} type="time" className="input w-36" value={t.end} onChange={(e) => setTimings(timings.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />}</Field>
                  <Button variant="ghost" className="text-danger" onClick={() => setTimings(timings.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
            </div>
          </Card>
          <Button type="submit" size="lg" busy={busy}>Save settings</Button>
        </form>
      )}
    </>
  );
}
