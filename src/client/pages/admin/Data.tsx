import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { addDays, istDate } from '../../../shared/format';
import { Card, Field, LinkButton, PageHeader } from '../../components/ui';

export default function AdminData() {
  const { user } = useAuth();
  const [from, setFrom] = useState(addDays(istDate(), -90));
  const [to, setTo] = useState(istDate());
  const qs = `from=${from}&to=${to}`;
  return (
    <>
      <PageHeader title="Data & backup" subtitle="CSV exports open in Excel or Google Sheets. Exports are recorded in the audit log." />
      <div className="space-y-4">
        <Card title="Date range">
          <div className="grid max-w-md grid-cols-2 gap-3">
            <Field label="From">{(id) => <input id={id} type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To">{(id) => <input id={id} type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Tanker bookings">
            <p className="mb-3 text-sm text-muted">Bookings with check-in details, litres received, short deliveries and final cost.</p>
            <LinkButton href={`/api/admin/data/bookings.csv?${qs}`} icon="download" download>Download CSV</LinkButton>
          </Card>
          <Card title="Expenses">
            <p className="mb-3 text-sm text-muted">Payments to vendors and other water expenses with mode and reference.</p>
            <LinkButton href={`/api/admin/data/expenses.csv?${qs}`} icon="download" download>Download CSV</LinkButton>
          </Card>
          <Card title="Tank readings">
            <p className="mb-3 text-sm text-muted">Every sensor, manual and check-in reading in the range.</p>
            <LinkButton href={`/api/admin/data/readings.csv?${qs}`} icon="download" download>Download CSV</LinkButton>
          </Card>
        </div>
        {user?.role === 'super_admin' && (
          <Card title="Full backup (JSON)">
            <p className="mb-3 text-sm text-muted">All tables in one file. Password hashes, session tokens and API key hashes are never included.</p>
            <LinkButton href="/api/admin/data/backup.json" icon="download" variant="primary" download>Download backup</LinkButton>
          </Card>
        )}
      </div>
    </>
  );
}
