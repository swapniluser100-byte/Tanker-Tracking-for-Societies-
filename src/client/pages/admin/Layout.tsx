import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../../shared/roles';
import { Icon, Logo, type IconName } from '../../components/icons';
import { cx } from '../../components/ui';

const NAV: { to: string; label: string; icon: IconName; superOnly?: boolean }[] = [
  { to: '/admin', label: 'Overview', icon: 'chart' },
  { to: '/admin/society', label: 'Society settings', icon: 'building' },
  { to: '/admin/flats', label: 'Wings & flats', icon: 'home' },
  { to: '/admin/tanks', label: 'Tanks', icon: 'tank' },
  { to: '/admin/vendors', label: 'Vendors', icon: 'truck' },
  { to: '/admin/options', label: 'Sizes & slots', icon: 'clock' },
  { to: '/admin/municipal', label: 'Municipal schedule', icon: 'calendar' },
  { to: '/admin/users', label: 'Users & roles', icon: 'users', superOnly: true },
  { to: '/admin/templates', label: 'Notification templates', icon: 'whatsapp' },
  { to: '/admin/api-keys', label: 'Sensor API keys', icon: 'key', superOnly: true },
  { to: '/admin/audit', label: 'Audit log', icon: 'shield' },
  { to: '/admin/data', label: 'Data & backup', icon: 'download' },
  { to: '/admin/account', label: 'My account', icon: 'settings' },
];

/** Admin console shell: dark sidebar so it is clearly separate from the committee app. */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const items = NAV.filter((n) => !n.superOnly || user?.role === 'super_admin');

  const nav = (
    <nav aria-label="Admin console" className="flex flex-col gap-0.5 px-3">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/admin'}
          className={({ isActive }) =>
            cx('flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors', isActive ? 'bg-white/12 text-white' : 'text-sidebar-ink hover:bg-white/6 hover:text-white')
          }
        >
          <Icon name={n.icon} size={19} />
          {n.label}
          {n.superOnly && <span className="ml-auto rounded bg-white/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-ink">Super</span>}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-2 border-t border-white/10 px-3 pt-4">
      <Link to="/app" className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium text-sidebar-ink hover:bg-white/6 hover:text-white">
        <Icon name="arrowLeft" size={19} /> Back to committee app
      </Link>
      <div className="px-3 text-sm">
        <div className="font-semibold text-white">{user?.name}</div>
        <div className="text-sidebar-ink">{user && ROLE_LABELS[user.role]}</div>
      </div>
      <button
        type="button"
        onClick={async () => { await logout(); navigate('/login'); }}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 font-medium text-sidebar-ink hover:bg-white/6 hover:text-white"
      >
        <Icon name="logout" size={19} /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col gap-5 overflow-y-auto bg-sidebar py-5 lg:flex">
        <div className="px-6">
          <Logo light />
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-sidebar-ink">Admin console</div>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-2 lg:hidden">
        <div>
          <Logo light />
        </div>
        <button type="button" onClick={() => setMenuOpen(true)} className="grid h-11 w-11 place-items-center rounded-lg text-white" aria-label="Open admin menu" aria-expanded={menuOpen}>
          <Icon name="menu" />
        </button>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto bg-sidebar py-4">
            <div className="flex items-center justify-between px-5">
              <span className="text-xs font-semibold uppercase tracking-widest text-sidebar-ink">Admin console</span>
              <button type="button" onClick={() => setMenuOpen(false)} className="grid h-11 w-11 place-items-center text-white" aria-label="Close menu"><Icon name="x" /></button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
