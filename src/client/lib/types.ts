// Shapes of API responses used by several screens.

export interface TankStatus {
  id: number;
  name: string;
  type: 'sump' | 'overhead';
  capacityLitres: number;
  wingId: number | null;
  wingName: string | null;
  alertPct: number;
  levelPct: number | null;
  litres: number | null;
  readingAt: string | null;
  readingSource: string | null;
  avgDailyUseLitres: number;
  hoursLeft: number | null;
  isLow: boolean;
}

export interface VendorStat {
  id: number;
  name: string;
  area: string;
  phone: string;
  upiId: string | null;
  ratePer10kPaise: number;
  isActive: boolean;
  trips: number;
  onTimePct: number | null;
  shortCount: number;
  shortPct: number | null;
  litresDelivered: number;
}

export interface MonthTotals {
  spentPaise: number;
  committedPaise: number;
  tankers: number;
  litresReceived: number;
  shortCount: number;
  shortLitres: number;
}

export interface MunicipalSlot { date: string; weekday: number; startTime: string; endTime: string; authority: string }
export interface MunicipalLog { date: string; came: boolean; actualStart: string | null; actualEnd: string | null; delayMinutes: number | null; notes: string | null }

export interface MunicipalSummary {
  schedule: { weekday: number; startTime: string; endTime: string; authority: string }[];
  week: MunicipalSlot[];
  next: MunicipalSlot | null;
  todayLog: MunicipalLog | null;
  recentLogs: MunicipalLog[];
  cameRatePct: number | null;
  avgDelayMinutes: number | null;
  logsCount: number;
}

export interface BookingRow {
  id: number;
  code: string;
  date: string;
  status: string;
  count: number;
  size_litres: number;
  cost_paise: number;
  final_cost_paise: number | null;
  rate_per_10k_paise?: number;
  eta_at: string | null;
  notes?: string | null;
  created_at?: string;
  vendor: string;
  vendor_id?: number;
  vendor_phone?: string;
  slot_label: string | null;
  start_time: string | null;
  end_time: string | null;
  tank?: string | null;
  booked_by?: string | null;
  approved_by?: string | null;
  vehicle_number: string | null;
  litres_received: number | null;
  short_by_litres: number | null;
  on_time: number | null;
  photo_key?: string | null;
  arrived_at: string | null;
  level_before_pct?: number | null;
  level_after_pct?: number | null;
}

/** Hours → "6 h" / "1 d 4 h" / "—" */
export function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
}
