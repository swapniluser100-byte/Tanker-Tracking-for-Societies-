import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { homeFor, passwordProblem, ROLE_LABELS } from '../../../shared/roles';
import { Button, Card, ErrorBanner, Field, useToast } from '../../components/ui';
import { Icon, Logo } from '../../components/icons';

/** Change password + log out of all sessions. Used standalone (forced reset) and inside the admin console. */
export function AccountPanel() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const isPinRole = user.role === 'guard' || user.role === 'resident';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(user!.role, next);
    if (problem) return setError(problem);
    if (next !== confirm) return setError('New passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { currentPassword: current, newPassword: next } });
      toast('Password changed. Other devices have been signed out.');
      setCurrent(''); setNext(''); setConfirm('');
      const me = await refresh();
      if (user!.mustResetPassword && me) navigate(homeFor(me.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function logoutAll() {
    if (!confirm_('Sign out of JalSetu on every device, including this one?')) return;
    await api('/auth/logout-all', { body: {} });
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="space-y-4">
      {user.mustResetPassword && (
        <div role="alert" className="rounded-xl border border-warn-accent/60 bg-warn-soft px-4 py-3 font-medium text-warn">
          Your administrator asked you to set a new password before continuing.
        </div>
      )}
      <Card title="Your account">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Name</dt><dd className="font-medium">{user.name}</dd></div>
          <div><dt className="text-muted">Role</dt><dd className="font-medium">{ROLE_LABELS[user.role]}</dd></div>
          {user.email && <div><dt className="text-muted">Email</dt><dd className="font-medium">{user.email}</dd></div>}
          {user.phone && <div><dt className="text-muted">Mobile</dt><dd className="font-medium">{user.phone}</dd></div>}
          {user.flat && <div><dt className="text-muted">Flat</dt><dd className="font-medium">{user.flat}</dd></div>}
        </dl>
      </Card>
      <Card title={isPinRole ? 'Change password or PIN' : 'Change password'}>
        <form onSubmit={submit} className="max-w-md space-y-3">
          <ErrorBanner error={error} />
          <Field label={isPinRole ? 'Current password or PIN' : 'Current password'}>
            {(id) => <input id={id} type="password" className="input" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
          <Field label="New password" hint={isPinRole ? 'A 6+ digit PIN or a 10+ character password.' : 'At least 10 characters.'}>
            {(id, d) => <input id={id} aria-describedby={d} type="password" className="input" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
          </Field>
          <Field label="Confirm new password">
            {(id) => <input id={id} type="password" className="input" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          <Button type="submit" busy={busy}>Update password</Button>
        </form>
      </Card>
      <Card title="Sessions">
        <p className="mb-3 text-muted">Lost a phone or used a shared computer? Sign out everywhere.</p>
        <Button variant="danger" icon="logout" onClick={logoutAll}>Log out of all sessions</Button>
      </Card>
    </div>
  );
}

const confirm_ = (msg: string) => window.confirm(msg);

export default function AccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to={user ? homeFor(user.role) : '/'} aria-label="JalSetu home"><Logo /></Link>
          <Button variant="ghost" size="sm" icon="logout" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {user && !user.mustResetPassword && (
          <Link to={homeFor(user.role)} className="mb-4 inline-flex min-h-11 items-center gap-1 font-semibold text-primary">
            <Icon name="arrowLeft" size={18} /> Back
          </Link>
        )}
        <h1 className="mb-4 text-2xl font-bold">My account</h1>
        <AccountPanel />
      </main>
    </div>
  );
}
