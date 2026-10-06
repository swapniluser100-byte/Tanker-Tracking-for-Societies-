// Pure business rules shared by the Worker, the React app and the tests.
// Money is integer paise; volumes are integer litres.

/** Litres received = (after % − before %) × tank capacity. Never negative. */
export function litresReceived(levelBeforePct: number, levelAfterPct: number, capacityLitres: number): number {
  const delta = (levelAfterPct - levelBeforePct) / 100;
  return Math.max(0, Math.round(delta * capacityLitres));
}

export interface ShortDeliveryResult {
  /** Litres short of the order (0 if at or above the order). */
  shortfall: number;
  /** True only when the shortfall is beyond the society's tolerance. */
  isShort: boolean;
  /** Litres to report as "Short by X L" (0 when within tolerance). */
  shortByLitres: number;
}

export function evaluateDelivery(orderedLitres: number, receivedLitres: number, toleranceLitres: number): ShortDeliveryResult {
  const shortfall = Math.max(0, orderedLitres - receivedLitres);
  const isShort = shortfall > toleranceLitres;
  return { shortfall, isShort, shortByLitres: isShort ? shortfall : 0 };
}

/** Cost of a booking: rate per 10,000 L × litres × count, rounded to the nearest paisa. */
export function bookingCostPaise(ratePer10kPaise: number, sizeLitres: number, count: number): number {
  return Math.round((ratePer10kPaise * sizeLitres * count) / 10_000);
}

/**
 * Pro-rated cost for a short delivery: pay only for the litres received.
 * Within tolerance the full ordered cost is paid.
 */
export function proRatedCostPaise(orderedCostPaise: number, orderedLitres: number, receivedLitres: number, isShort: boolean): number {
  if (!isShort || orderedLitres <= 0) return orderedCostPaise;
  const ratio = Math.min(1, Math.max(0, receivedLitres / orderedLitres));
  return Math.round(orderedCostPaise * ratio);
}

/** Cost per flat = month's total tanker spend ÷ number of flats. */
export function costPerFlatPaise(totalSpendPaise: number, flatsCount: number): number {
  if (flatsCount <= 0) return 0;
  return Math.round(totalSpendPaise / flatsCount);
}

/** Hours left = current litres ÷ (7-day average daily use ÷ 24). Null when usage is unknown. */
export function hoursLeft(currentLitres: number, avgDailyUseLitres: number): number | null {
  if (!(avgDailyUseLitres > 0)) return null;
  return currentLitres / (avgDailyUseLitres / 24);
}

/**
 * Average daily consumption from a chronological series of readings for one tank:
 * sums only the drops between consecutive readings (fills are ignored) and divides by
 * the number of days the series spans (at least 1).
 */
export function avgDailyUseFromReadings(readings: { litres: number; createdAt: string }[]): number {
  if (readings.length < 2) return 0;
  let used = 0;
  for (let i = 1; i < readings.length; i++) {
    const drop = readings[i - 1].litres - readings[i].litres;
    if (drop > 0) used += drop;
  }
  const spanMs = Date.parse(readings[readings.length - 1].createdAt) - Date.parse(readings[0].createdAt);
  const days = Math.max(1, spanMs / 86_400_000);
  return used / days;
}

/** Would adding `addLitres` overflow the tank? */
export function wouldOverflow(currentLitres: number, addLitres: number, capacityLitres: number): boolean {
  return currentLitres + addLitres > capacityLitres;
}

/** Indian vehicle registration, e.g. "MH 12 AB 1234". Accepts any spacing/case and normalises it. */
export function normaliseVehicleNumber(input: string): string | null {
  const m = input.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return null;
  const [, state, district, series, num] = m;
  return [state, district.padStart(2, '0'), series, num.padStart(4, '0')].filter(Boolean).join(' ');
}

export function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}
