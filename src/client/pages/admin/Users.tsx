import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { passwordProblem, ROLE_LABELS, type Role } from '../../../shared/roles';
import { formatDateTime } from '../../../shared/format';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Modal, PageHeader, Segmented, Table, useToast } from '../../components/ui';

interface UserRow {
  id: number; name: string; email: string | null; username: string | null; phone: string | null; role: Role; flat_id: number | null;
  flat: string | null; is_active: number; failed_attempts: number; locked_until: string | null; must_reset_password: number;
  last_login_at: string | null; active_sessions: number;
}
interface SessionRow { id: number; user_id: number; name: string; role: Role; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string }
interface Flat { id: number; number: string; wing: string }

const ROLES: Role[] = ['super_admin', 'committee_admin', 'treasurer', 'guard', 'resident'];
type Form = { id: number | null; name: string; email: string; username: string; phone: string; role: Role; flatId: string; isActive: boolean; password: string };

export default function AdminUsers() {
  const users = useApi<{ items: UserRow[] }>('/admin/users');
  const sessions = useApi<{ items: SessionRow[]; currentSessionId: number }>('/admin/sessions');
  const flats = useApi<{ items: Flat[] }>('/admin/flats');
  const { user: me } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'staff' | 'guard' | 'resident'>('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [tempPw, setTempPw] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data?.items ?? []).filter((u) =>
      (filter === 'all' || (filter === 'staff' ? ['super_admin', 'committee_admin', 'treasurer'].includes(u.role) : u.role === filter)) &&
      (!s || [u.name, u.email, u.username, u.phone, u.flat].some((v) => v?.toLowerCase().includes(s))));
  }, [users.data, filter, q]);

  const reloadAll = () => { void users.reload(); void sessions.reload(); };
  const isLocked = (u: UserRow) => u.locked_until && Date.parse(u.locked_until) > Date.now();

  async function act(path: string, msg: string, body: Record<string, unknown> = {}) {
    try {
      await api(path, { body });
      toast(msg);
      reloadAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (!form.id) {
      const p = passwordProblem(form.role, form.password);
      if (p) return setFormError(p);
    }
    setBusy(true);
    try {
      const body = { name: form.name, email: form.email, username: form.username, phone: form.phone, role: form.role, flatId: form.flatId ? Number(form.flatId) : null };
      if (form.id) await api(`/admin/users/${form.id}`, { method: 'PUT', body: { ...body, isActive: form.isActive } });
      else await api('/admin/users', { body: { ...body, password: form.password, mustResetPassword: true } });
      toast(form.id ? 'User updated' : 'User created — they must change the password at first login');
      setForm(null);
      reloadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!resetFor) return;
    const p = passwordProblem(resetFor.role, tempPw);
    if (p) return toast(p, 'error');
    await act(`/admin/users/${resetFor.id}/reset-password`, `Temporary password set for ${resetFor.name}`, { temporaryPassword: tempPw });
    setResetFor(null);
    setTempPw('');
  }

  async function revokeSession(s: SessionRow) {
    try {
      await api(`/admin/sessions/${s.id}`, { method: 'DELETE' });
      toast(`Signed out ${s.name} on that device`);
      reloadAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const open = (u?: UserRow) => {
    setFormError(null);
    setForm(u
      ? { id: u.id, name: u.name, email: u.email ?? '', username: u.username ?? '', phone: u.phone ?? '', role: u.role, flatId: u.flat_id ? String(u.flat_id) : '', isActive: Boolean(u.is_active), password: '' }
      : { id: null, name: '', email: '', username: '', phone: '', role: 'resident', flatId: '', isActive: true, password: '' });
  };

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Super admin only. Every change here is written to the audit log." actions={<Button icon="plus" onClick={() => open()}>Add user</Button>} />
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented label="Filter users" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'staff', label: 'Committee' }, { value: 'guard', label: 'Guards' }, { value: 'resident', label: 'Residents' }]} />
            <label className="sr-only" htmlFor="user-search">Search users</label>
            <input id="user-search" className="input max-w-xs" placeholder="Search name, phone, flat…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ErrorBanner error={users.error} onRetry={users.reload} />
          {users.loading && !users.data ? <Loading /> : (
            <Table label="Users">
              <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Login</th><th className="th">Status</th><th className="th">Last login</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                    <td className="td"><div className="font-semibold">{u.name}</div>{u.flat && <div className="text-muted">Flat {u.flat}</div>}</td>
                    <td className="td">{ROLE_LABELS[u.role]}</td>
                    <td className="td text-muted">{u.email ?? u.username ?? ''}{u.phone && <div>{u.phone}</div>}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {u.is_active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}
                        {isLocked(u) && <Chip tone="red">Locked</Chip>}
                        {u.must_reset_password ? <Chip tone="orange">Must reset</Chip> : null}
                        {u.active_sessions > 0 && <Chip tone="blue">{u.active_sessions} session{u.active_sessions > 1 ? 's' : ''}</Chip>}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-muted">{formatDateTime(u.last_login_at)}</td>
                    <td className="td">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => open(u)}>Edit</Button>
                        {isLocked(u) && <Button size="sm" variant="ghost" onClick={() => act(`/admin/users/${u.id}/unlock`, `${u.name} unlocked`)}>Unlock</Button>}
                        <Button size="sm" variant="ghost" onClick={() => { setTempPw(''); setResetFor(u); }}>Reset password</Button>
                        {!u.must_reset_password && u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => act(`/admin/users/${u.id}/force-reset`, `${u.name} must change password at next login`)}>Force reset</Button>}
                        {u.active_sessions > 0 && u.id !== me?.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(`/admin/users/${u.id}/revoke-sessions`, `${u.name} signed out everywhere`)}>Sign out</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Active sessions">
          <ErrorBanner error={sessions.error} />
          {sessions.data && (
            <Table label="Active sessions">
              <thead><tr><th className="th">User</th><th className="th">Device</th><th className="th">IP</th><th className="th">Last active</th><th className="th">Expires</th><th className="th" /></tr></thead>
              <tbody>
                {sessions.data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="td"><span className="font-semibold">{s.name}</span> <span className="text-muted">· {ROLE_LABELS[s.role]}</span></td>
                    <td className="td max-w-[16rem] truncate text-muted" title={s.user_agent ?? ''}>{s.user_agent ?? '—'}</td>
                    <td className="td text-muted">{s.ip ?? '—'}</td>
                    <td className="td whitespace-nowrap">{formatDateTime(s.last_seen_at)}</td>
                    <td className="td whitespace-nowrap">{formatDateTime(s.expires_at)}</td>
                    <td className="td text-right">
                      {s.id === sessions.data!.currentSessionId ? <Chip tone="blue">This device</Chip> : <Button size="sm" variant="ghost" className="text-danger" onClick={() => revokeSession(s)}>Revoke</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit user' : 'Add user'} footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="user-form" busy={busy}>Save</Button></>}>
        {form && (
          <form id="user-form" onSubmit={save} className="space-y-3">
            <ErrorBanner error={formError} />
            <Field label="Full name">{(id) => <input id={id} className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <Field label="Role">
              {(id) => (
                <select id={id} className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email">{(id) => <input id={id} type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
              <Field label="Username">{(id) => <input id={id} className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}</Field>
            </div>
            <Field label="Mobile number" hint={form.role === 'guard' || form.role === 'resident' ? 'Required — guards and residents sign in with their mobile number.' : 'Optional'}>
              {(id, d) => <input id={id} aria-describedby={d} type="tel" inputMode="numeric" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
            </Field>
            {(form.role === 'resident' || form.flatId) && (
              <Field label="Flat">
                {(id) => (
                  <select id={id} className="input" value={form.flatId} onChange={(e) => setForm({ ...form, flatId: e.target.value })}>
                    <option value="">— Not linked —</option>
                    {flats.data?.items.map((f) => <option key={f.id} value={f.id}>{f.wing}-{f.number}</option>)}
                  </select>
                )}
              </Field>
            )}
            {form.id ? (
              <label className="flex min-h-11 items-center gap-3 font-medium">
                <input type="checkbox" className="h-5 w-5 accent-[var(--color-primary)]" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} disabled={form.id === me?.id} />
                Account active (deactivating signs the user out everywhere)
              </label>
            ) : (
              <Field label="Temporary password" hint={form.role === 'guard' || form.role === 'resident' ? '6+ digit PIN or 10+ characters. They will be asked to change it.' : 'At least 10 characters. They will be asked to change it.'}>
                {(id, d) => <input id={id} aria-describedby={d} type="text" autoComplete="off" className="input font-mono" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
              </Field>
            )}
          </form>
        )}
      </Modal>

      <Modal open={Boolean(resetFor)} onClose={() => setResetFor(null)} title={`Reset password — ${resetFor?.name ?? ''}`} footer={<><Button variant="secondary" onClick={() => setResetFor(null)}>Cancel</Button><Button onClick={resetPassword} disabled={!tempPw}>Set temporary password</Button></>}>
        <p className="mb-3 text-sm text-muted">The user is signed out everywhere, the account is unlocked, and they must choose a new password at next login. Share the temporary password with them in person or by phone.</p>
        <Field label="Temporary password">{(id) => <input id={id} type="text" autoComplete="off" className="input font-mono" value={tempPw} onChange={(e) => setTempPw(e.target.value)} />}</Field>
      </Modal>
    </>
  );
}
