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
 * unauthenticated response — see netlify/functions/_shared/shape.ts.
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
