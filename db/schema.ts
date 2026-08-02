import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * A plot in the scheme. `owner` is personal data and must never reach an
 * unauthenticated response — see server/shape.ts.
 * `status` drives the fee obligation: only "Occupied" plots owe the monthly fee.
 */
export const plots = pgTable(
  "plots",
  {
    houseNo: text("house_no").primaryKey(),
    owner: text("owner"),
    status: text("status").notNull().default("Unregistered"),
    // 2025 balance carried forward into 2026
    bf2025: numeric("bf_2025", { precision: 12, scale: 2 }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("plots_status_idx").on(t.status)],
);

/** One row per plot per month. Absent row = nothing paid that month. */
export const collections = pgTable(
  "collections",
  {
    id: serial("id").primaryKey(),
    // onUpdate cascade lets a plot be renumbered without stranding its history
    houseNo: text("house_no")
      .notNull()
      .references(() => plots.houseNo, { onDelete: "cascade", onUpdate: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    uniqueIndex("collections_plot_period_idx").on(t.houseNo, t.year, t.month),
    index("collections_period_idx").on(t.year, t.month),
  ],
);

/** Income and expenditure outside the monthly membership fee. */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    // nullable: two source rows genuinely have no date recorded
    txDate: date("tx_date"),
    description: text("description").notNull(),
    category: text("category").notNull(),
    // "Contribution" | "Donation" | "Expense" — the first two are inflows
    type: text("type").notNull(),
    // expenses are stored negative, matching the source workbook
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("transactions_date_idx").on(t.txDate)],
);

/** Planned projects / goals. */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  priority: text("priority").notNull().default("Medium"),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2 }),
  quotationsReceived: integer("quotations_received").notNull().default(0),
  saved: numeric("saved", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("Planned"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Single-row-per-key config. `monthly_fee` and `months_completed` drive every
 * derived figure on the dashboard; months_completed used to be a manual cell in
 * the workbook and silently skewed the forecast when it went stale.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  note: text("note"),
});

/**
 * Editor accounts. `role` is what actually grants access — a row existing
 * here only proves the person can log in, matching how requireEditor() and
 * requireAdmin() in server/auth.ts check role, not just session validity.
 * "admin" is a superset of "editor": it can additionally manage users/invites.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    role: text("role").notNull().default("editor"), // "admin" | "editor"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/**
 * Pending account invitations. `token` is the whole access control — knowing
 * it is what lets `/editor?invite=...` create the account, so it is looked up
 * directly rather than joined on anything guessable like email.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull().default("editor"), // "admin" | "editor"
    token: text("token").notNull(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("invitations_token_idx").on(t.token)],
);

/**
 * Admin-issued password reset links. Same shape as invitations but scoped to
 * an existing user rather than an email — the account and its role are
 * unchanged, only the password. Shorter-lived than an invite since it grants
 * access to data that already exists, not just a fresh account.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("password_resets_token_idx").on(t.token)],
);

/** Who changed what. Meaningful because logins are per-person and invite-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    userEmail: text("user_email").notNull(),
    action: text("action").notNull(), // create | update | delete
    entity: text("entity").notNull(), // transaction | project | setting | collection
    entityId: text("entity_id"),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);
