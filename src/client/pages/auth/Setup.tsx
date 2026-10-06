import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, ApiError, useApi } from '../../lib/api';
import { Button, ErrorBanner, Field, FullPageSpinner } from '../../components/ui';
import { Logo } from '../../components/icons';

interface Status { needsSetup: boolean; needsSociety: boolean; tokenRequired: boolean; setupDisabled: boolean }

/** One-time first-run page that creates the super admin (and the society if missing). */
export default function Setup() {
  const status = useApi<Status>('/setup/status');
  const navigate = useNavigate();
  const [f, setF] = useState({ token: '', name: '', email: '', username: '', password: '', confirm: '', society: 'Sai Samarth Residency CHS', area: 'Wagholi', city: 'Pune', flats: '186' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (status.loading) return <FullPageSpinner />;
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password.length < 10) return setError('Password must be at least 10 characters.');
    if (f.password !== f.confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await api('/setup', {
        body: {
          token: f.token || undefined, name: f.name, email: f.email, username: f.username, password: f.password,
          society: status.data?.needsSociety ? { name: f.society, area: f.area, city: f.city, flatsCount: Number(f.flats) } : undefined,
        },
      });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center"><Logo className="text-2xl" /></div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-xl font-bold">First-time setup</h1>
          <p className="text-muted">Create the super admin account. This page disappears once it is done.</p>
          {status.data?.setupDisabled && (
            <ErrorBanner error="Setup is disabled until the ADMIN_BOOTSTRAP_TOKEN secret is set with `wrangler secret put ADMIN_BOOTSTRAP_TOKEN`." />
          )}
          <ErrorBanner error={error} />
          {status.data?.tokenRequired && (
            <Field label="Setup token" hint="The ADMIN_BOOTSTRAP_TOKEN secret you set with wrangler.">
              {(id, d) => <input id={id} aria-describedby={d} type="password" className="input" required value={f.token} onChange={set('token')} />}
            </Field>
          )}
          {status.data?.needsSociety && (
            <fieldset className="space-y-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Society</legend>
              <Field label="Society name">{(id) => <input id={id} className="input" required value={f.society} onChange={set('society')} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Area">{(id) => <input id={id} className="input" required value={f.area} onChange={set('area')} />}</Field>
                <Field label="City">{(id) => <input id={id} className="input" required value={f.city} onChange={set('city')} />}</Field>
              </div>
              <Field label="Number of flats">{(id) => <input id={id} type="number" inputMode="numeric" min={1} className="input" required value={f.flats} onChange={set('flats')} />}</Field>
            </fieldset>
          )}
          <Field label="Your name">{(id) => <input id={id} className="input" autoComplete="name" required value={f.name} onChange={set('name')} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">{(id) => <input id={id} type="email" className="input" autoComplete="email" required value={f.email} onChange={set('email')} />}</Field>
            <Field label="Username">{(id) => <input id={id} className="input" autoComplete="username" required value={f.username} onChange={set('username')} />}</Field>
          </div>
          <Field label="Password" hint="At least 10 characters.">
            {(id, d) => <input id={id} aria-describedby={d} type="password" className="input" autoComplete="new-password" required minLength={10} value={f.password} onChange={set('password')} />}
          </Field>
          <Field label="Confirm password">{(id) => <input id={id} type="password" className="input" autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} />}</Field>
          <Button type="submit" size="lg" className="w-full" busy={busy} disabled={status.data?.setupDisabled}>Create super admin</Button>
        </form>
      </div>
    </main>
  );
}
