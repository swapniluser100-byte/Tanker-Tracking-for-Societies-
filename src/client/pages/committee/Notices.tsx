import { useState } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BOOKING_MANAGERS } from '../../../shared/roles';
import { formatDate, formatDateTime } from '../../../shared/format';
import { Button, Card, Chip, Empty, ErrorBanner, Field, Loading, Modal, PageHeader, StatusChip, useToast } from '../../components/ui';

interface Notice { id: number; title: string; titleMr: string | null; body: string; bodyMr: string | null; priority: 'info' | 'important' | 'urgent'; expiresAt: string | null; createdAt: string }
interface Complaint { id: number; type: 'no_water' | 'leakage' | 'other'; flat: string | null; user_name: string | null; user_phone: string | null; description: string | null; status: 'open' | 'in_progress' | 'resolved'; created_at: string }

const COMPLAINT_LABEL = { no_water: 'No water', leakage: 'Leakage', other: 'Other' };
const PRIORITY_TONE = { info: 'grey', important: 'blue', urgent: 'orange' } as const;

export default function Notices() {
  const notices = useApi<{ notices: Notice[] }>('/notices');
  const complaints = useApi<{ complaints: Complaint[] }>('/complaints');
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user && BOOKING_MANAGERS.includes(user.role);
  const [form, setForm] = useState<{ title: string; titleMr: string; body: string; bodyMr: string; priority: Notice['priority']; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/notices', { body: { ...form, expiresAt: form.expiresAt || null } });
      toast('Notice published to residents');
      setForm(null);
      void notices.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function del(n: Notice) {
    if (!window.confirm(`Delete notice "${n.title}"?`)) return;
    await api(`/notices/${n.id}`, { method: 'DELETE' });
    void notices.reload();
  }

  async function setStatus(c: Complaint, status: Complaint['status']) {
    try {
      await api(`/complaints/${c.id}`, { method: 'PATCH', body: { status } });
      void complaints.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  return (
    <>
      <PageHeader title="Notices & complaints" actions={canEdit && <Button icon="plus" onClick={() => { setErr(null); setForm({ title: '', titleMr: '', body: '', bodyMr: '', priority: 'info', expiresAt: '' }); }}>New notice</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Notices">
          <ErrorBanner error={notices.error} />
          {notices.loading && !notices.data ? <Loading /> : !notices.data?.notices.length ? <Empty icon="bell">No notices.</Empty> : (
            <ul className="space-y-3">
              {notices.data.notices.map((n) => (
                <li key={n.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{n.title}</h3><Chip tone={PRIORITY_TONE[n.priority]}>{n.priority}</Chip></div>
                      {n.titleMr && <div lang="mr" className="text-sm text-muted">{n.titleMr}</div>}
                    </div>
                    {canEdit && <Button size="sm" variant="ghost" className="text-danger" onClick={() => del(n)}>Delete</Button>}
                  </div>
                  <p className="mt-1 text-sm">{n.body}</p>
                  <div className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt)}{n.expiresAt && ` · until ${formatDate(n.expiresAt)}`}{!n.bodyMr && ' · no Marathi text'}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Resident complaints">
          <ErrorBanner error={complaints.error} />
          {complaints.loading && !complaints.data ? <Loading /> : !complaints.data?.complaints.length ? <Empty icon="check">No complaints.</Empty> : (
            <ul className="divide-y divide-line">
              {complaints.data.complaints.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{COMPLAINT_LABEL[c.type]}</span>
                      {c.flat && <Chip>Flat {c.flat}</Chip>}
                      <StatusChip status={c.status} />
                    </div>
                    {c.description && <p className="mt-1 text-sm">{c.description}</p>}
                    <div className="text-xs text-muted">{c.user_name}{c.user_phone && <> · <a className="text-primary" href={`tel:+91${c.user_phone}`}>{c.user_phone}</a></>} · {formatDateTime(c.created_at)}</div>
                  </div>
                  {canEdit && c.status !== 'resolved' && (
                    <div className="flex gap-1">
                      {c.status === 'open' && <Button size="sm" variant="secondary" onClick={() => setStatus(c, 'in_progress')}>Working on it</Button>}
                      <Button size="sm" variant="ok" onClick={() => setStatus(c, 'resolved')}>Resolved</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} wide title="New notice for residents" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button busy={busy} disabled={!form?.title || !form.body} onClick={save}>Publish</Button></>}>
        {form && (
          <div className="space-y-3">
            <ErrorBanner error={err} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title (English)">{(id) => <input id={id} className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
              <Field label="शीर्षक (मराठी)">{(id) => <input id={id} lang="mr" className="input" value={form.titleMr} onChange={(e) => setForm({ ...form, titleMr: e.target.value })} />}</Field>
              <Field label="Message (English)">{(id) => <textarea id={id} className="input min-h-28" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field>
              <Field label="संदेश (मराठी)">{(id) => <textarea id={id} lang="mr" className="input min-h-28" value={form.bodyMr} onChange={(e) => setForm({ ...form, bodyMr: e.target.value })} />}</Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Priority">{(id) => <select id={id} className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Notice['priority'] })}><option value="info">Info</option><option value="important">Important</option><option value="urgent">Urgent</option></select>}</Field>
              <Field label="Show until (optional)">{(id) => <input id={id} type="date" className="input" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />}</Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
