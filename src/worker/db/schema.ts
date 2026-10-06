import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Conventions:
//  - Money is stored as integer paise (₹1 = 100 paise).
//  - Timestamps are ISO-8601 strings in UTC (e.g. 2026-10-06T04:30:00.000Z).
//  - Calendar dates (booking date, supply date) are 'YYYY-MM-DD' in Asia/Kolkata.
//  - Clock times (slots, schedules) are 'HH:MM' in Asia/Kolkata.
// One deployment serves one society (the single `societies` row).

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const updatedAt = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const bool = (name: string) => integer(name, { mode: 'boolean' });

export const ROLES = ['super_admin', 'committee_admin', 'treasurer', 'guard', 'resident'] as const;
export type Role = (typeof ROLES)[number];

export const BOOKING_STATUSES = ['pending_approval', 'confirmed', 'on_the_way', 'delivered', 'cancelled', 'rejected'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const societies = sqliteTable('societies', {
  id: id(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  city: text('city').notNull().default('Pune'),
  flatsCount: integer('flats_count').notNull(),
  monthlyBudgetPaise: integer('monthly_budget_paise').notNull().default(0),
  approvalLimitPaise: integer('approval_limit_paise').notNull().default(500000),
  shortToleranceLitres: integer('short_tolerance_litres').notNull().default(300),
  lowAlertPct: integer('low_alert_pct').notNull().default(30),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const wings = sqliteTable('wings', {
  id: id(),
  name: text('name').notNull().unique(),
  createdAt: createdAt(),
});

export const flats = sqliteTable(
  'flats',
  {
    id: id(),
    wingId: integer('wing_id').notNull().references(() => wings.id),
    number: text('number').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('flats_wing_number_uq').on(t.wingId, t.number)],
);

export const users = sqliteTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').unique(),
    username: text('username').unique(),
    phone: text('phone').unique(),
    passwordHash: text('password_hash').notNull(),
    salt: text('salt').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    flatId: integer('flat_id').references(() => flats.id),
    isActive: bool('is_active').notNull().default(true),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    mustResetPassword: bool('must_reset_password').notNull().default(false),
    lastLoginAt: text('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('users_role_idx').on(t.role)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const tanks = sqliteTable('tanks', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ['sump', 'overhead'] }).notNull(),
  capacityLitres: integer('capacity_litres').notNull(),
  wingId: integer('wing_id').references(() => wings.id),
  alertPct: integer('alert_pct').notNull().default(30),
  isActive: bool('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const tankReadings = sqliteTable(
  'tank_readings',
  {
    id: id(),
    tankId: integer('tank_id').notNull().references(() => tanks.id, { onDelete: 'cascade' }),
    levelPct: real('level_pct').notNull(),
    litres: integer('litres').notNull(),
    source: text('source', { enum: ['sensor', 'manual', 'checkin'] }).notNull(),
    userId: integer('user_id').references(() => users.id),
    apiKeyId: integer('api_key_id'),
    createdAt: createdAt(),
  },
  (t) => [index('tank_readings_tank_time_idx').on(t.tankId, t.createdAt)],
);

export const vendors = sqliteTable('vendors', {
  id: id(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  phone: text('phone').notNull(),
  upiId: text('upi_id'),
  ratePer10kPaise: integer('rate_per_10k_paise').notNull(),
  isActive: bool('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tankerSizes = sqliteTable('tanker_sizes', {
  id: id(),
  litres: integer('litres').notNull(),
  label: text('label').notNull(),
  isActive: bool('is_active').notNull().default(true),
});

export const deliverySlots = sqliteTable('delivery_slots', {
  id: id(),
  label: text('label').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  isActive: bool('is_active').notNull().default(true),
});

export const tankerBookings = sqliteTable(
  'tanker_bookings',
  {
    id: id(),
    code: text('code').notNull().unique(),
    vendorId: integer('vendor_id').notNull().references(() => vendors.id),
    sizeId: integer('size_id').references(() => tankerSizes.id),
    sizeLitres: integer('size_litres').notNull(), // snapshot of the size at booking time
    count: integer('count').notNull(),
    date: text('date').notNull(),
    slotId: integer('slot_id').references(() => deliverySlots.id),
    targetTankId: integer('target_tank_id').notNull().references(() => tanks.id),
    status: text('status', { enum: BOOKING_STATUSES }).notNull(),
    ratePer10kPaise: integer('rate_per_10k_paise').notNull(), // snapshot of the vendor rate
    costPaise: integer('cost_paise').notNull(), // estimated cost when booked
    finalCostPaise: integer('final_cost_paise'), // after check-in (pro-rated when short)
    etaAt: text('eta_at'),
    notes: text('notes'),
    bookedBy: integer('booked_by').references(() => users.id),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: text('approved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('bookings_date_idx').on(t.date), index('bookings_status_idx').on(t.status)],
);

export const deliveryCheckins = sqliteTable('delivery_checkins', {
  id: id(),
  bookingId: integer('booking_id').notNull().unique().references(() => tankerBookings.id),
  vehicleNumber: text('vehicle_number').notNull(),
  guardId: integer('guard_id').references(() => users.id),
  tankId: integer('tank_id').notNull().references(() => tanks.id),
  levelBeforePct: real('level_before_pct').notNull(),
  levelAfterPct: real('level_after_pct').notNull(),
  litresOrdered: integer('litres_ordered').notNull(),
  litresReceived: integer('litres_received').notNull(),
  shortByLitres: integer('short_by_litres').notNull().default(0), // > 0 only when beyond tolerance
  onTime: bool('on_time').notNull().default(true),
  photoKey: text('photo_key'),
  notes: text('notes'),
  arrivedAt: text('arrived_at').notNull(),
  createdAt: createdAt(),
});

export const municipalSchedule = sqliteTable('municipal_schedule', {
  id: id(),
  weekday: integer('weekday').notNull(), // 0 = Sunday … 6 = Saturday
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  authority: text('authority', { enum: ['PMC', 'PCMC'] }).notNull(),
  isActive: bool('is_active').notNull().default(true),
});

export const municipalSupplyLogs = sqliteTable('municipal_supply_logs', {
  id: id(),
  date: text('date').notNull().unique(),
  came: bool('came').notNull(),
  actualStart: text('actual_start'),
  actualEnd: text('actual_end'),
  delayMinutes: integer('delay_minutes'),
  notes: text('notes'),
  loggedBy: integer('logged_by').references(() => users.id),
  createdAt: createdAt(),
});

export const expenses = sqliteTable(
  'expenses',
  {
    id: id(),
    bookingId: integer('booking_id').references(() => tankerBookings.id),
    vendorId: integer('vendor_id').references(() => vendors.id),
    description: text('description').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    paymentMode: text('payment_mode', { enum: ['upi', 'cash', 'bank_transfer', 'cheque'] }).notNull(),
    paidDate: text('paid_date').notNull(),
    reference: text('reference'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_paid_date_idx').on(t.paidDate)],
);

export const notices = sqliteTable('notices', {
  id: id(),
  title: text('title').notNull(),
  titleMr: text('title_mr'),
  body: text('body').notNull(),
  bodyMr: text('body_mr'),
  priority: text('priority', { enum: ['info', 'important', 'urgent'] }).notNull().default('info'),
  expiresAt: text('expires_at'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const complaints = sqliteTable('complaints', {
  id: id(),
  type: text('type', { enum: ['no_water', 'leakage', 'other'] }).notNull(),
  flatId: integer('flat_id').references(() => flats.id),
  userId: integer('user_id').references(() => users.id),
  description: text('description'),
  status: text('status', { enum: ['open', 'in_progress', 'resolved'] }).notNull().default('open'),
  resolvedAt: text('resolved_at'),
  createdAt: createdAt(),
});

/** Committee alerts raised by the system (short deliveries, low tanks). */
export const alerts = sqliteTable('alerts', {
  id: id(),
  type: text('type', { enum: ['short_delivery', 'low_tank', 'sensor_offline'] }).notNull(),
  message: text('message').notNull(),
  bookingId: integer('booking_id').references(() => tankerBookings.id),
  acknowledgedBy: integer('acknowledged_by').references(() => users.id),
  acknowledgedAt: text('acknowledged_at'),
  createdAt: createdAt(),
});

export const notificationTemplates = sqliteTable(
  'notification_templates',
  {
    id: id(),
    key: text('key').notNull(),
    language: text('language', { enum: ['en', 'mr'] }).notNull(),
    channel: text('channel', { enum: ['whatsapp', 'sms'] }).notNull().default('whatsapp'),
    description: text('description'),
    text: text('text').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('templates_key_lang_channel_uq').on(t.key, t.language, t.channel)],
);

export const apiKeys = sqliteTable('api_keys', {
  id: id(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(), // first characters, shown in the UI to identify the key
  keyHash: text('key_hash').notNull().unique(),
  scope: text('scope', { enum: ['readings:write'] }).notNull().default('readings:write'),
  tankId: integer('tank_id').references(() => tanks.id), // optional: restrict key to one tank
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    userId: integer('user_id'),
    action: text('action').notNull(), // create | update | delete | login | login_failed | logout | …
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_entity_idx').on(t.entity, t.entityId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type Society = typeof societies.$inferSelect;
export type Tank = typeof tanks.$inferSelect;
export type Booking = typeof tankerBookings.$inferSelect;
