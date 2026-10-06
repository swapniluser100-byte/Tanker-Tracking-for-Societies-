import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/api';
import { ADMIN_CONSOLE, BOOKING_MANAGERS, ROLE_LABELS } from '../../../shared/roles';
import { Icon, Logo } from '../../components/icons';
import { cx } from '../../components/ui';

const NAV = [
  { to: '/app', label: 'Dashboard' },
  { to: '/app/bookings', label: 'Tanker bookings' },
  { to: '/app/tanks', label: 'Tanks' },
  { to: '/app/vendors', label: 'Vendors' },
  { to: '/app/expenses', label: 'Expenses' },
  { to: '/app/notices', label: 'Notices' },
];

interface Society { society: { name: string; area: string; city: string; flatsCount: number } }

export default function CommitteeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data } = useApi<Society>('/dashboard/society');
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const canBook = user && BOOKING_MANAGERS.includes(user.role);
  const isAdmin = user && ADMIN_CONSOLE.includes(user.role);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/app" aria-label="JalSetu dashboard"><Logo /></Link>
          {data && (
            <div className="hidden min-w-0 border-l border-line pl-3 md:block">
              <div className="truncate font-semibold leading-tight">{data.society.name}</div>
              <div className="text-xs text-muted">{data.society.area}, {data.society.city} · {data.society.flatsCount} flats</div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {canBook && (
              <Link to="/app/book" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 font-semibold text-white hover:bg-primary-dark">
                <Icon name="truck" size={18} /> <span>Book tanker</span>
              </Link>
            )}
            {isAdmin && (
              <Link to="/admin" className="hidden min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong px-3 font-semibold hover:bg-page sm:inline-flex">
                <Icon name="settings" size={18} /> Admin
              </Link>
            )}
            <button type="button" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-page lg:hidden" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              <Icon name={menuOpen ? 'x' : 'menu'} />
            </button>
            <div className="hidden items-center gap-2 lg:flex">
              <Link to="/account" className="text-right text-sm leading-tight hover:underline">
                <div className="font-semibold">{user?.name}</div>
                <div className="text-muted">{user && ROLE_LABELS[user.role]}</div>
              </Link>
              <button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-page" aria-label="Sign out" onClick={async () => { await logout(); navigate('/login'); }}>
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </div>
        <nav aria-label="Committee" className={cx('mx-auto max-w-7xl px-2 sm:px-4', menuOpen ? 'block' : 'hidden lg:block')}>
          <ul className="flex flex-col gap-0.5 pb-2 lg:flex-row lg:pb-0">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/app'}
                  className={({ isActive }) => cx('flex min-h-11 items-center border-b-2 px-3 font-semibold transition-colors', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
            <li className="lg:hidden"><NavLink to="/resident" className="flex min-h-11 items-center px-3 font-semibold text-muted">Resident view</NavLink></li>
            {isAdmin && <li className="lg:hidden"><NavLink to="/admin" className="flex min-h-11 items-center px-3 font-semibold text-muted">Admin console</NavLink></li>}
            <li className="lg:hidden"><NavLink to="/account" className="flex min-h-11 items-center px-3 font-semibold text-muted">My account</NavLink></li>
            <li className="lg:hidden"><button type="button" className="flex min-h-11 w-full items-center px-3 font-semibold text-muted" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</button></li>
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
