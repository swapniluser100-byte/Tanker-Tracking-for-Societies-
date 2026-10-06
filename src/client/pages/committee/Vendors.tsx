import { useState } from 'react';
import { useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ADMIN_CONSOLE } from '../../../shared/roles';
import { formatINR, formatLitres } from '../../../shared/format';
import type { VendorStat } from '../../lib/types';
import { Button, Card, Chip, ErrorBanner, Loading, PageHeader, Table, cx } from '../../components/ui';
import { VendorHistory } from '../admin/Entities';

export default function Vendors() {
  const { data, error, loading, reload } = useApi<{ vendors: VendorStat[] }>('/vendors');
  const { user } = useAuth();
  const [history, setHistory] = useState<VendorStat | null>(null);
  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="On-time % and short deliveries are calculated from guard check-ins."
        actions={user && ADMIN_CONSOLE.includes(user.role) && <a href="/admin/vendors" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-4 font-semibold hover:bg-page">Edit vendors</a>}
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <Card>
          <Table label="Vendors">
            <thead><tr><th className="th">Vendor</th><th className="th">Contact</th><th className="th text-right">Rate / 10k L</th><th className="th text-right">Trips</th><th className="th text-right">On time</th><th className="th text-right">Short</th><th className="th text-right">Delivered</th><th className="th" /></tr></thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.id} className={v.isActive ? '' : 'opacity-60'}>
                  <td className="td"><div className="font-semibold">{v.name}</div><div className="text-xs text-muted">{v.area}{!v.isActive && ' · inactive'}</div></td>
                  <td className="td"><a className="font-medium text-primary" href={`tel:+91${v.phone}`}>{v.phone}</a>{v.upiId && <div className="text-xs text-muted">{v.upiId}</div>}</td>
                  <td className="td text-right num">{formatINR(v.ratePer10kPaise)}</td>
                  <td className="td text-right num">{v.trips}</td>
                  <td className={cx('td text-right num', (v.onTimePct ?? 100) < 80 && 'font-semibold text-warn')}>{v.onTimePct == null ? '—' : `${Math.round(v.onTimePct)}%`}</td>
                  <td className="td text-right num">{v.shortCount ? <Chip tone={(v.shortPct ?? 0) > 10 ? 'orange' : 'grey'}>{v.shortCount} ({Math.round(v.shortPct ?? 0)}%)</Chip> : '0'}</td>
                  <td className="td text-right num">{formatLitres(v.litresDelivered)}</td>
                  <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setHistory(v)}>History</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {history && <VendorHistory vendor={history} onClose={() => setHistory(null)} />}
    </>
  );
}
