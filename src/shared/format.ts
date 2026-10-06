// Indian number/date formatting. Display timezone is always Asia/Kolkata.

export const TZ = 'Asia/Kolkata';

const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 150000 → "1,50,000" */
export const formatNumber = (n: number) => intFmt.format(Math.round(n));

/** 150000 → "1,50,000 L" (non-breaking space, so it never wraps) */
export const formatLitres = (litres: number) => `${intFmt.format(Math.round(litres))}\u00A0L`;

/** 2520000 paise → "₹ 25,200" */
export const formatINR = (paise: number) => `₹\u00A0${inrFmt.format(Math.round(paise / 100))}`;

/** Rupees with paise when non-zero: 2520050 → "₹ 25,200.50" */
export const formatINRExact = (paise: number) =>
  `₹\u00A0${new Intl.NumberFormat('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paise / 100)}`;

/** 'YYYY-MM-DD' of an instant in Asia/Kolkata. */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** 'HH:MM' (24h) of an instant in Asia/Kolkata. */
export function istTime(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** 0 = Sunday … 6 = Saturday, in Asia/Kolkata. */
export function istWeekday(d: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Converts an IST calendar date + 'HH:MM' into a UTC ISO string. IST is a fixed +05:30. */
export function istToUtcIso(date: string, time = '00:00'): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

/** Adds days to a 'YYYY-MM-DD' date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** '06:00' → '6:00 AM' */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(dateOrIso: string | null | undefined): string {
  if (!dateOrIso) return '—';
  const d = dateOrIso.length === 10 ? new Date(`${dateOrIso}T12:00:00+05:30`) : new Date(dateOrIso);
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

/** 'YYYY-MM' → 'Oct 2026' */
export function formatMonth(ym: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
}

/** Fills {{placeholders}} in a notification template. Unknown placeholders are left as-is. */
export function renderTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}
