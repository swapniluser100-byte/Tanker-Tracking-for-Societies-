/**
 * Generates seed/seed.sql with realistic sample data for one society:
 * Sai Samarth Residency CHS, Wagholi, Pune — 186 flats in 3 wings, six months of
 * tanker bookings, check-ins, expenses, 14 days of tank readings and PMC supply logs.
 *
 *   npm run db:seed:local     (generate + apply to local D1)
 *   npm run db:seed:remote    (generate + apply to the remote D1 — demo environments only!)
 *
 * WARNING: the generated SQL first deletes all existing rows.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { hashPassword, sha256Hex, generateToken } from '../src/worker/lib/crypto';
import { bookingCostPaise, evaluateDelivery, litresReceived, proRatedCostPaise } from '../src/shared/calc';
import { addDays, istDate, istToUtcIso } from '../src/shared/format';

// Demo credentials — for local/demo use only. Change or delete these users in production.
const STAFF_PASSWORD = 'JalSetu@2026';
const PIN = '246810';

// Deterministic PRNG so the seed is reproducible (except the timestamps, which follow "now").
let s = 20261006;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const out: string[] = [];
const insert = (table: string, row: Record<string, unknown>) => {
  const cols = Object.keys(row);
  out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
};

const now = new Date();
const today = istDate(now);
const nowIso = now.toISOString();

async function main() {
  // ── wipe (children first) ────────────────────────────────────────────────
  for (const t of [
    'audit_logs', 'alerts', 'expenses', 'delivery_checkins', 'tanker_bookings', 'tank_readings', 'api_keys',
    'sessions', 'complaints', 'notices', 'municipal_supply_logs', 'users', 'tanks', 'flats', 'wings', 'vendors', 'tanker_sizes',
    'delivery_slots', 'municipal_schedule', 'notification_templates', 'settings', 'societies',
  ]) out.push(`DELETE FROM ${t};`);
  out.push(`DELETE FROM sqlite_sequence;`);

  // ── society ──────────────────────────────────────────────────────────────
  insert('societies', {
    id: 1, name: 'Sai Samarth Residency CHS', area: 'Wagholi', city: 'Pune', flats_count: 186,
    monthly_budget_paise: 225_000_00, approval_limit_paise: 5_000_00, short_tolerance_litres: 300,
    low_alert_pct: 30, timezone: 'Asia/Kolkata',
  });

  // ── wings & flats: A and B have 16 floors × 4; C has 14 floors × 4 + 2 penthouses = 186 ──
  const wingDefs = [
    { id: 1, name: 'A', floors: 16, extra: 0 },
    { id: 2, name: 'B', floors: 16, extra: 0 },
    { id: 3, name: 'C', floors: 14, extra: 2 },
  ];
  const flatIds: { id: number; wing: string; number: string }[] = [];
  let flatId = 0;
  for (const w of wingDefs) {
    insert('wings', { id: w.id, name: w.name });
    for (let f = 1; f <= w.floors; f++)
      for (let u = 1; u <= 4; u++) {
        const number = `${f}0${u}`;
        insert('flats', { id: ++flatId, wing_id: w.id, number });
        flatIds.push({ id: flatId, wing: w.name, number });
      }
    for (let u = 1; u <= w.extra; u++) {
      const number = `${w.floors + 1}0${u}`;
      insert('flats', { id: ++flatId, wing_id: w.id, number });
      flatIds.push({ id: flatId, wing: w.name, number });
    }
  }
  if (flatIds.length !== 186) throw new Error(`expected 186 flats, got ${flatIds.length}`);
  const flatOf = (wing: string, number: string) => flatIds.find((f) => f.wing === wing && f.number === number)!.id;

  // ── users ────────────────────────────────────────────────────────────────
  const staff = [
    { id: 1, name: 'Aditi Deshpande', email: 'admin@saisamarth.example', username: 'admin', role: 'super_admin', phone: null },
    { id: 2, name: 'Prakash Jadhav', email: 'secretary@saisamarth.example', username: 'secretary', role: 'committee_admin', phone: '9000000102' },
    { id: 3, name: 'Meera Patil', email: 'treasurer@saisamarth.example', username: 'treasurer', role: 'treasurer', phone: '9000000103' },
  ];
  for (const u of staff) {
    const { hash, salt } = await hashPassword(STAFF_PASSWORD);
    insert('users', { ...u, password_hash: hash, salt, is_active: 1, last_login_at: istToUtcIso(addDays(today, -1), '19:15') });
  }
  const guards = [
    { id: 4, name: 'Santosh Gaikwad', phone: '9000000201' },
    { id: 5, name: 'Ramesh More', phone: '9000000202' },
  ];
  for (const g of guards) {
    const { hash, salt } = await hashPassword(PIN);
    insert('users', { ...g, role: 'guard', password_hash: hash, salt, is_active: 1 });
  }
  const residents = [
    ['Sneha Kulkarni', 'A', '704'], ['Vikram Shinde', 'A', '1202'], ['Anjali Joshi', 'B', '303'],
    ['Rahul Pawar', 'B', '1104'], ['Pooja Bhosale', 'C', '501'], ['Nitin Chavan', 'C', '1402'],
    ['Kavita Deshmukh', 'A', '201'], ['Sachin Kale', 'B', '902'],
  ] as const;
  let uid = 5;
  for (const [i, [name, wing, number]] of residents.entries()) {
    const { hash, salt } = await hashPassword(PIN);
    insert('users', { id: ++uid, name, phone: `90000003${String(i + 1).padStart(2, '0')}`, role: 'resident', flat_id: flatOf(wing, number), password_hash: hash, salt, is_active: 1 });
  }

  // ── tanks ────────────────────────────────────────────────────────────────
  const tanks = [
    { id: 1, name: 'Main Sump', type: 'sump', capacity_litres: 150_000, wing_id: null, alert_pct: 30, current: 46, dailyUse: 78_000 },
    { id: 2, name: 'A-Wing Overhead', type: 'overhead', capacity_litres: 30_000, wing_id: 1, alert_pct: 30, current: 64, dailyUse: 27_000 },
    { id: 3, name: 'B-Wing Overhead', type: 'overhead', capacity_litres: 30_000, wing_id: 2, alert_pct: 30, current: 24, dailyUse: 27_500 },
    { id: 4, name: 'C-Wing Overhead', type: 'overhead', capacity_litres: 27_000, wing_id: 3, alert_pct: 30, current: 55, dailyUse: 23_500 },
  ];
  for (const { current: _c, dailyUse: _d, ...t } of tanks) insert('tanks', { ...t, is_active: 1 });

  // ── vendors / sizes / slots ──────────────────────────────────────────────
  const vendors = [
    { id: 1, name: 'Shree Balaji Water Suppliers', area: 'Wagholi', phone: '9000000401', upi_id: 'balajiwater@okaxis', rate: 1_750_00, onTime: 0.92, short: 0.05, active: 1 },
    { id: 2, name: 'Jai Malhar Tankers', area: 'Kharadi', phone: '9000000402', upi_id: 'jaimalhar.tankers@oksbi', rate: 1_650_00, onTime: 0.74, short: 0.17, active: 1 },
    { id: 3, name: 'Om Sai Jal Vahatuk', area: 'Lohegaon', phone: '9000000403', upi_id: 'omsaijal@okicici', rate: 1_900_00, onTime: 0.97, short: 0.02, active: 1 },
    { id: 4, name: 'Mauli Water Supply', area: 'Wagholi', phone: '9000000404', upi_id: 'mauliwater@ybl', rate: 1_800_00, onTime: 0.6, short: 0.25, active: 0 },
  ];
  for (const v of vendors)
    insert('vendors', { id: v.id, name: v.name, area: v.area, phone: v.phone, upi_id: v.upi_id, rate_per_10k_paise: v.rate, is_active: v.active });

  const sizes = [
    { id: 1, litres: 5_000, label: '5,000 L (small)' },
    { id: 2, litres: 10_000, label: '10,000 L (standard)' },
    { id: 3, litres: 12_000, label: '12,000 L' },
    { id: 4, litres: 20_000, label: '20,000 L (large)' },
  ];
  for (const z of sizes) insert('tanker_sizes', { ...z, is_active: 1 });
  const slots = [
    { id: 1, label: 'Early morning', start_time: '06:00', end_time: '08:00' },
    { id: 2, label: 'Morning', start_time: '08:00', end_time: '10:00' },
    { id: 3, label: 'Late morning', start_time: '10:00', end_time: '12:00' },
    { id: 4, label: 'Afternoon', start_time: '14:00', end_time: '16:00' },
    { id: 5, label: 'Evening', start_time: '16:00', end_time: '18:00' },
  ];
  for (const sl of slots) insert('delivery_slots', { ...sl, is_active: 1 });

  // ── bookings + check-ins + expenses: last 180 days ───────────────────────
  const vehicles: Record<number, string[]> = {
    1: ['MH 12 KT 4471', 'MH 12 QW 2290', 'MH 12 LP 8812'],
    2: ['MH 14 GH 3305', 'MH 14 DX 7716'],
    3: ['MH 12 RN 5520', 'MH 12 TB 0934'],
    4: ['MH 12 FC 6610'],
  };
  let bookingId = 0;
  let checkinId = 0;
  const code = (id: number) => `TK-${1000 + id}`;
  const sumpCap = 150_000;

  for (let d = 180; d >= 1; d--) {
    const date = addDays(today, -d);
    const monthsAgo = d / 30;
    const vendorPool = monthsAgo > 4.5 ? [1, 2, 4] : [1, 1, 2, 3, 3]; // Mauli dropped ~4 months ago
    const bookingsToday = randInt(2, 3);
    const usedSlots = new Set<number>();
    for (let b = 0; b < bookingsToday; b++) {
      const vendorId = pick(vendorPool);
      const vendor = vendors.find((v) => v.id === vendorId)!;
      const size = chance(0.7) ? sizes[1] : chance(0.5) ? sizes[2] : sizes[3];
      const count = size.litres >= 20_000 ? 1 : chance(0.65) ? 1 : 2;
      let slot = pick(slots);
      while (usedSlots.has(slot.id) && usedSlots.size < slots.length) slot = pick(slots);
      usedSlots.add(slot.id);
      const cost = bookingCostPaise(vendor.rate, size.litres, count);
      const needsApproval = cost > 5_000_00;
      const id = ++bookingId;
      const createdAt = istToUtcIso(addDays(date, -1), `${String(randInt(9, 20)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`);

      const cancelled = chance(0.03);
      const ordered = size.litres * count;
      const shortfall = chance(vendor.short) ? randInt(400, 1600) * count : randInt(0, 200);
      const before = randInt(200, 550) / 10;
      const received = ordered - shortfall;
      const after = Math.min(100, Math.round((before + (received / sumpCap) * 100) * 10) / 10);
      const recv = litresReceived(before, after, sumpCap);
      const evald = evaluateDelivery(ordered, recv, 300);
      const finalCost = proRatedCostPaise(cost, ordered, recv, evald.isShort);
      const onTime = chance(vendor.onTime);
      const [eh, em] = slot.end_time.split(':').map(Number);
      const [sh] = slot.start_time.split(':').map(Number);
      const arrivalMin = onTime ? sh * 60 + randInt(0, (eh - sh) * 60 - 10) : eh * 60 + randInt(20, 100);
      const arrivedAt = istToUtcIso(date, `${String(Math.floor(arrivalMin / 60)).padStart(2, '0')}:${String(arrivalMin % 60).padStart(2, '0')}`);
      void em;

      insert('tanker_bookings', {
        id, code: code(id), vendor_id: vendor.id, size_id: size.id, size_litres: size.litres, count, date, slot_id: slot.id,
        target_tank_id: 1, status: cancelled ? 'cancelled' : 'delivered', rate_per_10k_paise: vendor.rate, cost_paise: cost,
        final_cost_paise: cancelled ? null : finalCost, booked_by: 2, approved_by: needsApproval ? 3 : null,
        approved_at: needsApproval ? createdAt : null, created_at: createdAt, updated_at: cancelled ? createdAt : arrivedAt,
      });
      if (cancelled) continue;
      insert('delivery_checkins', {
        id: ++checkinId, booking_id: id, vehicle_number: pick(vehicles[vendor.id]), guard_id: pick([4, 5]), tank_id: 1,
        level_before_pct: before, level_after_pct: after, litres_ordered: ordered, litres_received: recv,
        short_by_litres: evald.shortByLitres, on_time: onTime ? 1 : 0, arrived_at: arrivedAt, created_at: arrivedAt,
      });
      if (evald.isShort) {
        insert('alerts', {
          type: 'short_delivery', booking_id: id, message: `${code(id)} from ${vendor.name} short by ${evald.shortByLitres} L`,
          acknowledged_by: d > 2 ? 2 : null, acknowledged_at: d > 2 ? arrivedAt : null, created_at: arrivedAt,
        });
      }
      // Treasurer pays vendors by UPI within a week; the last few days are still unpaid.
      const paidDate = addDays(date, randInt(1, 7));
      if (paidDate < today) {
        insert('expenses', {
          booking_id: id, vendor_id: vendor.id, description: `Tanker ${code(id)} — ${recv.toLocaleString('en-IN')} L`,
          amount_paise: finalCost, payment_mode: chance(0.85) ? 'upi' : pick(['cash', 'bank_transfer']), paid_date: paidDate,
          reference: `UPI${randInt(100000000, 999999999)}`, created_by: 3, created_at: istToUtcIso(paidDate, '11:30'),
        });
      }
    }
  }
  // Non-tanker society water expenses (pump repair, tank cleaning)
  insert('expenses', { description: 'Sump pump motor rewinding', amount_paise: 8_500_00, payment_mode: 'bank_transfer', paid_date: addDays(today, -40), created_by: 3 });
  insert('expenses', { description: 'Overhead tank cleaning (A, B, C)', amount_paise: 12_000_00, payment_mode: 'upi', paid_date: addDays(today, -75), created_by: 3 });

  // Today and tomorrow — live bookings for the dashboard and the guard's list
  const live = [
    { vendor: 3, size: sizes[1], count: 1, date: today, slot: 1, status: 'delivered' },
    { vendor: 1, size: sizes[1], count: 2, date: today, slot: 2, status: 'on_the_way' },
    { vendor: 2, size: sizes[2], count: 1, date: today, slot: 4, status: 'confirmed' },
    { vendor: 1, size: sizes[1], count: 1, date: today, slot: 5, status: 'confirmed' },
    { vendor: 3, size: sizes[1], count: 3, date: addDays(today, 1), slot: 1, status: 'pending_approval' },
    { vendor: 1, size: sizes[2], count: 1, date: addDays(today, 1), slot: 3, status: 'confirmed' },
  ];
  for (const l of live) {
    const vendor = vendors.find((v) => v.id === l.vendor)!;
    const cost = bookingCostPaise(vendor.rate, l.size.litres, l.count);
    const id = ++bookingId;
    const delivered = l.status === 'delivered';
    const ordered = l.size.litres * l.count;
    insert('tanker_bookings', {
      id, code: code(id), vendor_id: vendor.id, size_id: l.size.id, size_litres: l.size.litres, count: l.count, date: l.date,
      slot_id: l.slot, target_tank_id: 1, status: l.status, rate_per_10k_paise: vendor.rate, cost_paise: cost,
      final_cost_paise: delivered ? cost : null, booked_by: 2, approved_by: cost > 5_000_00 && l.status !== 'pending_approval' ? 3 : null,
      eta_at: l.status === 'on_the_way' ? new Date(now.getTime() + 40 * 60_000).toISOString() : null,
      created_at: istToUtcIso(addDays(today, -1), '18:40'),
    });
    if (delivered) {
      insert('delivery_checkins', {
        id: ++checkinId, booking_id: id, vehicle_number: 'MH 12 RN 5520', guard_id: 4, tank_id: 1, level_before_pct: 39.5,
        level_after_pct: 46, litres_ordered: ordered, litres_received: litresReceived(39.5, 46, sumpCap), short_by_litres: 0,
        on_time: 1, arrived_at: istToUtcIso(today, '06:42'), created_at: istToUtcIso(today, '06:42'),
      });
    }
  }

  // ── tank readings: 14 days every 2 h, simulated backwards from the current level ──
  // Hourly demand profile (2-hour buckets): peaks at 6–10 AM and 6–10 PM.
  const profile = [0.3, 0.2, 0.6, 2.0, 1.8, 1.0, 0.9, 0.7, 0.9, 1.8, 1.4, 0.6];
  const profileSum = profile.reduce((a, b) => a + b, 0);
  const stepMs = 2 * 3600_000;
  const lastSensor = new Date(now.getTime() - 7 * 60_000);
  for (const t of tanks) {
    let level = t.current;
    const points: { at: Date; level: number }[] = [];
    for (let i = 0; i < 14 * 12; i++) {
      const at = new Date(lastSensor.getTime() - i * stepMs);
      points.push({ at, level });
      const istHour = (at.getUTCHours() + 5.5) % 24;
      const usePct = ((t.dailyUse * (profile[Math.floor(istHour / 2)] / profileSum)) / t.capacity_litres) * 100 * (0.85 + rand() * 0.3);
      let prev = level + usePct;
      // Going back in time past a refill (pump or tanker) the tank was lower.
      if (prev > (t.type === 'sump' ? 80 : 92)) prev -= t.type === 'sump' ? randInt(15, 25) : randInt(45, 55);
      level = Math.max(8, Math.min(98, prev));
    }
    for (const p of points.reverse()) {
      const lvl = Math.round(p.level * 10) / 10;
      insert('tank_readings', { tank_id: t.id, level_pct: lvl, litres: Math.round((lvl / 100) * t.capacity_litres), source: 'sensor', api_key_id: 1, created_at: p.at.toISOString() });
    }
  }
  insert('tank_readings', { tank_id: 1, level_pct: 39.5, litres: 59_250, source: 'manual', user_id: 4, created_at: istToUtcIso(today, '06:40') });

  // ── sensor API key (only the hash is stored; the plain key is printed once below) ──
  const sensorKey = `js_live_${generateToken(24)}`;
  insert('api_keys', { id: 1, name: 'ESP32 – Main Sump ultrasonic', prefix: sensorKey.slice(0, 12), key_hash: await sha256Hex(sensorKey), scope: 'readings:write', created_by: 1, last_used_at: lastSensor.toISOString(), created_at: istToUtcIso(addDays(today, -60), '10:00') });

  // ── PMC schedule (alternate days) and supply logs ────────────────────────
  const schedule = [
    { weekday: 1, start_time: '05:30', end_time: '07:30' },
    { weekday: 3, start_time: '05:30', end_time: '07:30' },
    { weekday: 5, start_time: '05:30', end_time: '07:30' },
    { weekday: 0, start_time: '06:00', end_time: '08:00' },
  ];
  for (const sc of schedule) insert('municipal_schedule', { ...sc, authority: 'PMC', is_active: 1 });
  for (let d = 45; d >= 1; d--) {
    const date = addDays(today, -d);
    const wd = new Date(`${date}T12:00:00+05:30`).getUTCDay();
    const sc = schedule.find((x) => x.weekday === wd);
    if (!sc) continue;
    const came = chance(0.72);
    const delay = came ? pick([0, 0, 10, 15, 25, 40, 60, 90]) : null;
    const [h, m] = sc.start_time.split(':').map(Number);
    const startMin = h * 60 + m + (delay ?? 0);
    const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    insert('municipal_supply_logs', {
      date, came: came ? 1 : 0, actual_start: came ? hhmm(startMin) : null, actual_end: came ? hhmm(startMin + randInt(70, 120)) : null,
      delay_minutes: delay, notes: came ? null : pick(['No supply — PMC pipeline repair at Wagholi', 'Skipped, low pressure', 'No water, no prior notice']),
      logged_by: 4, created_at: istToUtcIso(date, '09:00'),
    });
  }

  // ── notices ──────────────────────────────────────────────────────────────
  const notices = [
    { title: 'PMC supply skipped on Wednesday', title_mr: 'बुधवारी महापालिकेचा पाणीपुरवठा बंद', body: 'PMC has informed that there will be no supply on Wednesday due to pipeline work near Kesnand Phata. Extra tankers have been booked. Please use water carefully.', body_mr: 'केसनंद फाटा येथील पाइपलाइनच्या कामामुळे बुधवारी पाणीपुरवठा होणार नाही, असे महापालिकेने कळवले आहे. जादा टँकर मागवले आहेत. कृपया पाणी जपून वापरा.', priority: 'urgent', days: 1 },
    { title: 'Overhead tank cleaning on Sunday', title_mr: 'रविवारी ओव्हरहेड टाकीची स्वच्छता', body: 'B-wing overhead tank will be cleaned on Sunday from 11 AM to 3 PM. Water will be off in B-wing during this time. Please store water in advance.', body_mr: 'रविवारी सकाळी ११ ते दुपारी ३ या वेळेत बी-विंगच्या ओव्हरहेड टाकीची स्वच्छता होईल. या वेळेत बी-विंगमधील पाणी बंद राहील. कृपया आधीच पाणी साठवून ठेवा.', priority: 'important', days: 3 },
    { title: 'Please report leakages', title_mr: 'गळती असल्यास कळवा', body: 'Every litre counts. If you notice a leaking tap, flush or pipe in common areas, use "Report leakage" in the JalSetu app.', body_mr: 'प्रत्येक थेंब मोलाचा आहे. सामायिक जागेत नळ, फ्लश किंवा पाइपमधून गळती दिसल्यास जलसेतू ॲपमधील "गळती कळवा" वापरा.', priority: 'info', days: 9 },
  ];
  for (const n of notices) insert('notices', { title: n.title, title_mr: n.title_mr, body: n.body, body_mr: n.body_mr, priority: n.priority, created_by: 2, created_at: istToUtcIso(addDays(today, -n.days), '10:00') });

  // ── complaints ───────────────────────────────────────────────────────────
  insert('complaints', { type: 'no_water', flat_id: flatOf('B', '1104'), user_id: 9, description: 'No water in kitchen since morning', status: 'open', created_at: new Date(now.getTime() - 90 * 60_000).toISOString() });
  insert('complaints', { type: 'leakage', flat_id: flatOf('A', '704'), user_id: 6, description: 'Leakage near A-wing parking pipe', status: 'in_progress', created_at: istToUtcIso(addDays(today, -2), '08:15') });
  insert('complaints', { type: 'no_water', flat_id: flatOf('C', '501'), user_id: 10, description: 'Low pressure on 5th floor', status: 'resolved', resolved_at: istToUtcIso(addDays(today, -4), '17:00'), created_at: istToUtcIso(addDays(today, -5), '07:30') });

  // ── notification templates ───────────────────────────────────────────────
  const templates: [string, 'en' | 'mr', 'whatsapp' | 'sms', string, string][] = [
    ['daily_update', 'en', 'whatsapp', 'Daily water update for residents', '💧 *{{society}} — water update*\nStored now: {{litres}} ({{percent}}%)\nTankers today: {{tankers}}\nPMC supply: {{pmc}}\nWater timings: {{time}}\nPlease use water carefully. 🙏'],
    ['daily_update', 'mr', 'whatsapp', 'Daily water update for residents', '💧 *{{society}} — पाणी अपडेट*\nसध्या साठा: {{litres}} ({{percent}}%)\nआजचे टँकर: {{tankers}}\nमहापालिका पुरवठा: {{pmc}}\nपाण्याच्या वेळा: {{time}}\nकृपया पाणी जपून वापरा. 🙏'],
    ['tanker_arriving', 'en', 'whatsapp', 'Tanker on the way', '🚚 Tanker {{code}} ({{litres}}) is on the way. Expected by {{time}}.'],
    ['tanker_arriving', 'mr', 'whatsapp', 'Tanker on the way', '🚚 टँकर {{code}} ({{litres}}) येत आहे. अंदाजे {{time}} पर्यंत पोहोचेल.'],
    ['low_water', 'en', 'whatsapp', 'Low tank alert', '⚠️ {{tank}} is at {{percent}}% (~{{hours}} hours left). Flat {{flat}}: please avoid washing cars and filling extra buckets.'],
    ['low_water', 'mr', 'whatsapp', 'Low tank alert', '⚠️ {{tank}} मध्ये फक्त {{percent}}% पाणी (~{{hours}} तास पुरेल). सदनिका {{flat}}: कृपया गाड्या धुणे व जादा बादल्या भरणे टाळा.'],
    ['supply_skipped', 'en', 'sms', 'PMC supply skipped', 'JalSetu: PMC supply did not come today ({{time}}). Tankers have been arranged. Use water carefully.'],
    ['supply_skipped', 'mr', 'sms', 'PMC supply skipped', 'जलसेतू: आज ({{time}}) महापालिकेचे पाणी आले नाही. टँकरची व्यवस्था केली आहे. पाणी जपून वापरा.'],
    ['short_delivery', 'en', 'sms', 'Short delivery alert to committee', 'JalSetu: {{code}} short by {{litres}}. Cost pro-rated. Check the challan photo.'],
    ['short_delivery', 'mr', 'sms', 'Short delivery alert to committee', 'जलसेतू: {{code}} मध्ये {{litres}} पाणी कमी आले. रक्कम प्रमाणानुसार कमी केली. चलनाचा फोटो तपासा.'],
  ];
  for (const [key, language, channel, description, text] of templates) insert('notification_templates', { key, language, channel, description, text });

  // ── settings ─────────────────────────────────────────────────────────────
  insert('settings', { key: 'water_release_timings', value: JSON.stringify([{ start: '06:00', end: '09:30' }, { start: '18:00', end: '21:00' }]) });
  insert('settings', { key: 'committee_whatsapp_number', value: '919000000102' });

  // ── audit log samples ────────────────────────────────────────────────────
  insert('audit_logs', { user_id: 1, action: 'update', entity: 'society', entity_id: '1', before_json: JSON.stringify({ approvalLimitPaise: 400000 }), after_json: JSON.stringify({ approvalLimitPaise: 500000 }), ip: '127.0.0.1', created_at: istToUtcIso(addDays(today, -20), '21:05') });
  insert('audit_logs', { user_id: 1, action: 'create', entity: 'api_key', entity_id: '1', after_json: JSON.stringify({ name: 'ESP32 – Main Sump ultrasonic' }), ip: '127.0.0.1', created_at: istToUtcIso(addDays(today, -60), '10:00') });
  insert('audit_logs', { user_id: 2, action: 'login', entity: 'user', entity_id: '2', ip: '127.0.0.1', created_at: istToUtcIso(addDays(today, -1), '19:15') });

  mkdirSync('seed', { recursive: true });
  writeFileSync('seed/seed.sql', out.join('\n') + '\n');

  console.log(`Wrote seed/seed.sql (${out.length} statements) — generated ${nowIso}`);
  console.log('\nDemo logins (change these before any real use):');
  console.log(`  Super admin      admin / ${STAFF_PASSWORD}`);
  console.log(`  Committee admin  secretary / ${STAFF_PASSWORD}`);
  console.log(`  Treasurer        treasurer / ${STAFF_PASSWORD}`);
  console.log(`  Guard            phone 9000000201 / PIN ${PIN}`);
  console.log(`  Resident (B-1104) phone 9000000304 / PIN ${PIN}`);
  console.log(`\nSensor API key for "ESP32 – Main Sump ultrasonic" (shown once, only its hash is stored):\n  ${sensorKey}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
