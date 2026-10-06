import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireRole, useAuth } from './lib/auth';
import { FullPageSpinner, ToastProvider } from './components/ui';
import { ADMIN_CONSOLE, COMMITTEE_VIEW, GUARD_APP, homeFor, SUPER_ONLY } from '../shared/roles';
import Login from './pages/auth/Login';

// Each app area is its own chunk, so the guard and resident phones only download what they use.
const Setup = lazy(() => import('./pages/auth/Setup'));
const AccountPage = lazy(() => import('./pages/auth/Account'));
const CommitteeLayout = lazy(() => import('./pages/committee/Layout'));
const Dashboard = lazy(() => import('./pages/committee/Dashboard'));
const Bookings = lazy(() => import('./pages/committee/Bookings'));
const BookTanker = lazy(() => import('./pages/committee/BookTanker'));
const Tanks = lazy(() => import('./pages/committee/Tanks'));
const Vendors = lazy(() => import('./pages/committee/Vendors'));
const Expenses = lazy(() => import('./pages/committee/Expenses'));
const Notices = lazy(() => import('./pages/committee/Notices'));
const AdminLayout = lazy(() => import('./pages/admin/Layout'));
const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminSociety = lazy(() => import('./pages/admin/Society'));
const AdminFlats = lazy(() => import('./pages/admin/Flats'));
const AdminEntities = lazy(() => import('./pages/admin/Entities'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminTemplates = lazy(() => import('./pages/admin/Templates'));
const AdminApiKeys = lazy(() => import('./pages/admin/ApiKeys'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const AdminData = lazy(() => import('./pages/admin/Data'));
const AdminAccount = lazy(() => import('./pages/admin/Account'));
const GuardApp = lazy(() => import('./pages/guard/GuardApp'));
const ResidentApp = lazy(() => import('./pages/resident/ResidentApp'));

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/account" element={<RequireRole roles={['super_admin', 'committee_admin', 'treasurer', 'guard', 'resident']}><AccountPage /></RequireRole>} />

              <Route path="/app" element={<RequireRole roles={COMMITTEE_VIEW}><CommitteeLayout /></RequireRole>}>
                <Route index element={<Dashboard />} />
                <Route path="bookings" element={<Bookings />} />
                <Route path="book" element={<BookTanker />} />
                <Route path="tanks" element={<Tanks />} />
                <Route path="vendors" element={<Vendors />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="notices" element={<Notices />} />
              </Route>

              <Route path="/admin" element={<RequireRole roles={ADMIN_CONSOLE}><AdminLayout /></RequireRole>}>
                <Route index element={<AdminOverview />} />
                <Route path="society" element={<AdminSociety />} />
                <Route path="flats" element={<AdminFlats />} />
                <Route path="tanks" element={<AdminEntities kind="tanks" />} />
                <Route path="vendors" element={<AdminEntities kind="vendors" />} />
                <Route path="options" element={<AdminEntities kind="options" />} />
                <Route path="municipal" element={<AdminEntities kind="municipal" />} />
                <Route path="users" element={<RequireRole roles={SUPER_ONLY}><AdminUsers /></RequireRole>} />
                <Route path="templates" element={<AdminTemplates />} />
                <Route path="api-keys" element={<RequireRole roles={SUPER_ONLY}><AdminApiKeys /></RequireRole>} />
                <Route path="audit" element={<AdminAudit />} />
                <Route path="data" element={<AdminData />} />
                <Route path="account" element={<AdminAccount />} />
              </Route>

              <Route path="/guard" element={<RequireRole roles={GUARD_APP}><GuardApp /></RequireRole>} />
              <Route path="/resident/*" element={<RequireRole roles={['resident', ...COMMITTEE_VIEW]}><ResidentApp /></RequireRole>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
