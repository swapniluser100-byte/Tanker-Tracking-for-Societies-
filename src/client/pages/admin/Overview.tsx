import { Link } from 'react-router';
import { useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatINR, formatLitres } from '../../../shared/format';
import { ROLE_LABELS, type Role } from '../../../shared/roles';
import { Card, Chip, ErrorBanner, Loading, PageHeader, Stat } from '../../components/ui';

interface Overview {
  health: { database: string; dbLatencyMs: number; r2: string; kv: string; sensor: string };
  counts: Record<string, number | string | null>;
  usersByRole: { role: Role; n: number }[];
  lastSensorReading: string | null;
  sensorAgeMinutes: number | null;
  month: { spentPaise: number; tankers: number; litresReceived: number; shortCount: number };
  environment: string;
}

const tone = (s: string) => (s === 'ok' ? 'green' : s === 'stale' || s === 'no data' ? 'orange' : 'red');

export default function AdminOverview() {
  const { data, error, loading, reload } = useApi<Overview>('/admin/overview');
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Overview" subtitle="System health and activity at a glance" />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon="users" label="Active users" value={String(data.counts.active_users)} sub={`${data.counts.active_sessions} signed in now`} />
            <Stat icon="truck" label="Bookings this month" value={String(data.counts.bookings_this_month)} sub={`${data.counts.pending_approvals} awaiting approval`} />
            <Stat icon="shield" label="Failed logins today" value={String(data.counts.failed_logins_today)} sub={`${data.counts.locked_users} account(s) locked`} tone={Number(data.counts.failed_logins_today) > 10 ? 'warn' : 'default'} />
            <Stat icon="tank" label="Last sensor reading" value={data.sensorAgeMinutes === null ? '—' : `${data.sensorAgeMinutes} min ago`} sub={formatDateTime(data.lastSensorReading)} tone={data.health.sensor === 'ok' ? 'default' : 'warn'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="System health">
              <ul className="divide-y divide-line">
                {[
                  ['D1 database', data.health.database, `${data.health.dbLatencyMs} ms query`],
                  ['R2 photo storage', data.health.r2, 'Tanker & challan photos'],
                  ['KV (rate limiting)', data.health.kv, 'Sensor & login limits'],
                  ['Tank sensors', data.health.sensor, `${data.counts.active_api_keys} active API key(s)`],
                ].map(([name, status, sub]) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <div className="font-medium">{name}</div>
                      <div className="text-sm text-muted">{sub}</div>
                    </div>
                    <Chip tone={tone(status)}>{status === 'ok' ? 'Healthy' : status}</Chip>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted">Environment: <strong>{data.environment}</strong></p>
            </Card>
            <Card title="Users by role" action={user?.role === 'super_admin' && <Link to="/admin/users" className="text-sm font-semibold text-primary">Manage</Link>}>
              <ul className="divide-y divide-line">
                {data.usersByRole.map((r) => (
                  <li key={r.role} className="flex justify-between py-2.5">
                    <span>{ROLE_LABELS[r.role]}</span>
                    <span className="font-semibold num">{r.n}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="This month">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><div className="text-sm text-muted">Tanker spend</div><div className="text-lg font-semibold num">{formatINR(data.month.spentPaise)}</div></div>
              <div><div className="text-sm text-muted">Tankers delivered</div><div className="text-lg font-semibold num">{data.month.tankers}</div></div>
              <div><div className="text-sm text-muted">Litres received</div><div className="text-lg font-semibold num">{formatLitres(data.month.litresReceived)}</div></div>
              <div><div className="text-sm text-muted">Short deliveries</div><div className="text-lg font-semibold num">{data.month.shortCount}</div></div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
