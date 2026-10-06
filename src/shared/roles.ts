// Role groups used by both the API middleware and the UI (the UI only hides things; the API enforces).

export type Role = 'super_admin' | 'committee_admin' | 'treasurer' | 'guard' | 'resident';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  committee_admin: 'Committee admin',
  treasurer: 'Treasurer',
  guard: 'Security guard',
  resident: 'Resident',
};

export const ADMIN_CONSOLE: Role[] = ['super_admin', 'committee_admin'];
export const SUPER_ONLY: Role[] = ['super_admin'];
export const COMMITTEE_VIEW: Role[] = ['super_admin', 'committee_admin', 'treasurer'];
export const BOOKING_MANAGERS: Role[] = ['super_admin', 'committee_admin'];
export const APPROVERS: Role[] = ['super_admin', 'treasurer'];
export const EXPENSE_MANAGERS: Role[] = ['super_admin', 'treasurer'];
export const GUARD_APP: Role[] = ['super_admin', 'committee_admin', 'guard'];
export const STAFF_ROLES: Role[] = ['super_admin', 'committee_admin', 'treasurer'];

/** Where each role lands after login. */
export function homeFor(role: Role): string {
  if (role === 'guard') return '/guard';
  if (role === 'resident') return '/resident';
  return '/app';
}

/**
 * Password rules: staff need at least 10 characters. Guards and residents may use a
 * numeric PIN of at least 6 digits (simpler on shared phones) or a 10+ character password.
 * Returns an error message, or null when acceptable.
 */
export function passwordProblem(role: Role, password: string): string | null {
  if (password.length > 128) return 'Password is too long (max 128 characters).';
  const isPin = /^\d+$/.test(password);
  if ((role === 'guard' || role === 'resident') && isPin) {
    if (password.length < 6) return 'PIN must be at least 6 digits.';
    if (/^(\d)\1+$/.test(password) || '0123456789'.includes(password) || '9876543210'.includes(password))
      return 'PIN is too easy to guess.';
    return null;
  }
  if (password.length < 10) return 'Password must be at least 10 characters.';
  return null;
}
