import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError, useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { homeFor } from '../../../shared/roles';
import { Button, ErrorBanner, Field, FullPageSpinner } from '../../components/ui';
import { Logo } from '../../components/icons';
import { Turnstile, type TurnstileHandle } from '../../components/Turnstile';

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const config = useApi<{ turnstileSiteKey: string }>('/auth/config');
  const setup = useApi<{ needsSetup: boolean }>('/setup/status');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    if (setup.data?.needsSetup) navigate('/setup', { replace: true });
  }, [setup.data, navigate]);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={user.mustResetPassword ? '/account' : homeFor(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Please wait for the "I am human" check to finish.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/login', { body: { identifier, password, turnstileToken: token } });
      const me = await refresh();
      const next = params.get('next');
      if (me?.mustResetPassword) navigate('/account', { replace: true });
      else navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(me!.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection.');
      setPassword('');
      turnstile.current?.reset(); // tokens are single-use
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Logo className="text-2xl" />
          <p className="mt-2 text-muted">Water tanker & supply tracker for your society</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          <h1 className="text-xl font-bold">Sign in</h1>
          <ErrorBanner error={error} />
          <Field label="Email, username or mobile number">
            {(id) => (
              <input id={id} className="input" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
            )}
          </Field>
          <Field label="Password or PIN" hint="Guards and residents can use their 6-digit PIN.">
            {(id, d) => (
              <input id={id} aria-describedby={d} type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          {config.data && <Turnstile ref={turnstile} siteKey={config.data.turnstileSiteKey} onToken={setToken} onError={setError} />}
          <Button type="submit" className="w-full" size="lg" busy={busy} disabled={!identifier || !password}>
            Sign in
          </Button>
          <p className="text-center text-sm text-muted">Forgot your password? Ask your society's super admin to reset it.</p>
        </form>
      </div>
    </main>
  );
}
