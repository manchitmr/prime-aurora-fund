import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./_shared/db.ts";
import { requireEditor, json, type Editor } from "./_shared/auth.ts";

/* Contribution and Donation are both inflows; only the label and the reporting
   split differ. "Income" is still accepted so an older client or a bookmarked
   request cannot start failing mid-session — it is normalised on the way in. */
const TYPES = new Set(["Contribution", "Donation", "Expense"]);
const TYPE_ALIASES: Record<string, string> = { Income: "Contribution" };
const STATUSES = new Set(["Occupied", "Unregistered", "Pending", "Bare Land", "Vacant House"]);

/**
 * NOTE ON STATUS CODES: these handlers never return 404.
 * A 404 from a path-routed Netlify function makes the platform treat the route
 * as unhandled and fall through to static-file candidates, which then re-enters
 * this function with a mangled path and reports a misleading error. Domain
 * "not found" cases use 400 (bad input) or 409 (row vanished) instead.
 */

class Invalid extends Error {}

/* ------------------------------------------------------------------ helpers */

const str = (v: unknown, field: string, { max = 200, required = true } = {}) => {
  if (v == null || v === "") {
    if (required) throw new Invalid(`${field} is required.`);
    return null;
  }
  const s = String(v).trim();
  if (!s && required) throw new Invalid(`${field} is required.`);
  if (s.length > max) throw new Invalid(`${field} must be ${max} characters or fewer.`);
  return s || null;
};

const money = (v: unknown, field: string, { required = true } = {}) => {
  if (v == null || v === "") {
    if (required) throw new Invalid(`${field} is required.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Invalid(`${field} must be a number.`);
  if (Math.abs(n) > 1e11) throw new Invalid(`${field} is out of range.`);
  return Math.round(n * 100) / 100;
};

const isoDate = (v: unknown, field: string) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Invalid(`${field} must be a date (YYYY-MM-DD).`);
  if (Number.isNaN(Date.parse(s))) throw new Invalid(`${field} is not a real date.`);
  return s;
};

async function audit(
  editor: Editor, action: string, entity: string,
  entityId: string | number | null, detail: unknown,
) {
  await db.insert(schema.auditLog).values({
    userEmail: editor.email, action, entity,
    entityId: entityId == null ? null : String(entityId),
    detail: detail as any,
  });
}

/* ------------------------------------------------------------------ handler */

export default async (req: Request, context: Context) => {
  const editor = await requireEditor();
  if (editor instanceof Response) return editor;

  const entity = context.params?.entity;
  const id = context.params?.id;
  const method = req.method.toUpperCase();

  let body: any = {};
  if (method !== "DELETE") {
    try {
      body = await req.json();
    } catch {
      return json({ error: "Expected a JSON body." }, 400);
    }
  }

  try {
    switch (entity) {
      case "transactions": return await transactions(method, id, body, editor);
      case "projects":     return await projects(method, id, body, editor);
      case "settings":     return await setting(method, id, body, editor);
      case "collections":  return await collection(method, body, editor);
      case "plots":        return await plot(method, id, body, editor);
      default:
        return json({ error: `Unknown resource '${entity}'.` }, 400);
    }
  } catch (err) {
    if (err instanceof Invalid) return json({ error: err.message }, 400);
    console.error("admin-mutate failed", entity, method, err);
    return json({ error: "The change could not be saved." }, 500);
  }
};

/* ---------------------------------------------------------------- resources */

async function transactions(method: string, id: string | undefined, b: any, editor: Editor) {
  if (method === "POST" || method === "PUT") {
    const raw = str(b.type, "Type")!;
    const type = TYPE_ALIASES[raw] ?? raw;
    if (!TYPES.has(type))
      throw new Invalid(`Type must be one of: ${[...TYPES].join(", ")}.`);

    // Expenses are stored negative so that a plain SUM gives the fund balance,
    // matching the source workbook. Accept either sign from the client.
    const magnitude = Math.abs(money(b.amount, "Amount")!);
    const amount = type === "Expense" ? -magnitude : magnitude;

    const values = {
      txDate: isoDate(b.date, "Date"),
      description: str(b.description, "Description", { max: 300 })!,
      category: str(b.category, "Category", { max: 100 })!,
      type,
      amount: String(amount),
      notes: str(b.notes, "Notes", { max: 500, required: false }),
    };

    if (method === "POST") {
      const [row] = await db.insert(schema.transactions).values(values).returning();
      await audit(editor, "create", "transaction", row.id, values);
      return json({ ok: true, row }, 201);
    }
    if (!id) throw new Invalid("Missing transaction id.");
    const [row] = await db.update(schema.transactions).set(values)
      .where(eq(schema.transactions.id, Number(id))).returning();
    if (!row) return json({ error: "That transaction no longer exists." }, 409);
    await audit(editor, "update", "transaction", id, values);
    return json({ ok: true, row });
  }

  if (method === "DELETE") {
    if (!id) throw new Invalid("Missing transaction id.");
    const [row] = await db.delete(schema.transactions)
      .where(eq(schema.transactions.id, Number(id))).returning();
    if (!row) return json({ error: "That transaction no longer exists." }, 409);
    await audit(editor, "delete", "transaction", id, row);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function projects(method: string, id: string | undefined, b: any, editor: Editor) {
  if (method === "POST" || method === "PUT") {
    const values = {
      name: str(b.name, "Project name", { max: 200 })!,
      priority: str(b.priority, "Priority", { max: 20 }) ?? "Medium",
      estimatedCost: nullableMoney(b.cost, "Estimated cost"),
      quotationsReceived: Math.max(0, Math.trunc(Number(b.quotations ?? 0)) || 0),
      saved: nullableMoney(b.saved, "Saved"),
      status: str(b.status, "Status", { max: 30 }) ?? "Planned",
      note: str(b.note, "Note", { max: 500, required: false }),
    };
    if (method === "POST") {
      const [row] = await db.insert(schema.projects).values(values).returning();
      await audit(editor, "create", "project", row.id, values);
      return json({ ok: true, row }, 201);
    }
    if (!id) throw new Invalid("Missing project id.");
    const [row] = await db.update(schema.projects).set(values)
      .where(eq(schema.projects.id, Number(id))).returning();
    if (!row) return json({ error: "That project no longer exists." }, 409);
    await audit(editor, "update", "project", id, values);
    return json({ ok: true, row });
  }

  if (method === "DELETE") {
    if (!id) throw new Invalid("Missing project id.");
    const [row] = await db.delete(schema.projects)
      .where(eq(schema.projects.id, Number(id))).returning();
    if (!row) return json({ error: "That project no longer exists." }, 409);
    await audit(editor, "delete", "project", id, row);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function setting(method: string, key: string | undefined, b: any, editor: Editor) {
  if (method !== "PUT") return json({ error: "Method not allowed." }, 405);
  if (!key) throw new Invalid("Missing setting key.");

  const value = str(b.value, "Value", { max: 200 })!;

  // These two drive every derived figure, so they are range-checked rather than
  // trusted; a stale months_completed silently skews the whole forecast.
  if (key === "months_completed") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 12)
      throw new Invalid("Months completed must be a whole number from 0 to 12.");
  }
  if (key === "monthly_fee") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Invalid("Monthly fee must be zero or more.");
  }

  const [row] = await db.update(schema.settings).set({ value })
    .where(eq(schema.settings.key, key)).returning();
  if (!row) return json({ error: `Unknown setting '${key}'.` }, 400);
  await audit(editor, "update", "setting", key, { value });
  return json({ ok: true, row });
}

/** Upsert one plot-month cell. Zero or blank clears it. */
async function collection(method: string, b: any, editor: Editor) {
  if (method !== "PUT") return json({ error: "Method not allowed." }, 405);

  const houseNo = str(b.house, "Plot", { max: 20 })!;
  const year = Math.trunc(Number(b.year));
  const month = Math.trunc(Number(b.month));
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Invalid("Year is out of range.");
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Invalid("Month must be 1 to 12.");

  const [exists] = await db.select().from(schema.plots).where(eq(schema.plots.houseNo, houseNo));
  if (!exists) return json({ error: `Unknown plot '${houseNo}'.` }, 400);

  const raw = b.amount;
  const amount = raw == null || raw === "" ? 0 : money(raw, "Amount")!;
  if (amount < 0) throw new Invalid("A collection cannot be negative.");

  const where = and(
    eq(schema.collections.houseNo, houseNo),
    eq(schema.collections.year, year),
    eq(schema.collections.month, month),
  );

  if (amount === 0) {
    await db.delete(schema.collections).where(where);
    await audit(editor, "delete", "collection", `${houseNo}/${year}-${month}`, null);
    return json({ ok: true, amount: 0 });
  }

  await db
    .insert(schema.collections)
    .values({ houseNo, year, month, amount: String(amount) })
    .onConflictDoUpdate({
      target: [schema.collections.houseNo, schema.collections.year, schema.collections.month],
      set: { amount: String(amount) },
    });
  await audit(editor, "update", "collection", `${houseNo}/${year}-${month}`, { amount });
  return json({ ok: true, amount });
}

async function plot(method: string, houseNo: string | undefined, b: any, editor: Editor) {
  if (method !== "PUT") return json({ error: "Method not allowed." }, 405);
  if (!houseNo) throw new Invalid("Missing plot number.");

  const status = str(b.status, "Status", { max: 30 })!;
  if (!STATUSES.has(status))
    throw new Invalid(`Status must be one of: ${[...STATUSES].join(", ")}.`);

  const values: Record<string, unknown> = {
    owner: str(b.owner, "Owner", { max: 200, required: false }),
    status,
    bf2025: nullableMoney(b.bf, "2025 balance"),
  };

  /* Renumbering rewrites the primary key. The foreign key carries ON UPDATE
     CASCADE, so the plot's collections follow it automatically — but a
     collision with an existing plot would silently merge two histories, so it
     is rejected up front rather than left to the database. */
  const renumberTo = str(b.house, "Plot number", { max: 20, required: false });
  if (renumberTo && renumberTo !== houseNo) {
    const [clash] = await db.select().from(schema.plots)
      .where(eq(schema.plots.houseNo, renumberTo));
    if (clash)
      throw new Invalid(
        `Plot ${renumberTo} already exists. Give it a number that is not in use.`);
    values.houseNo = renumberTo;
  }

  const [row] = await db.update(schema.plots).set(values as any)
    .where(eq(schema.plots.houseNo, houseNo)).returning();
  if (!row) return json({ error: `Unknown plot '${houseNo}'.` }, 400);

  await audit(editor, "update", "plot", houseNo,
    values.houseNo ? { ...values, renumberedFrom: houseNo } : values);
  return json({ ok: true, row, renumbered: values.houseNo ? renumberTo : null });
}

function nullableMoney(v: unknown, field: string) {
  const n = money(v, field, { required: false });
  return n == null ? null : String(n);
}

// Deliberately not /api/admin/:entity — that would also match /api/admin/data
// and make routing depend on match precedence.
export const config: Config = {
  path: ["/api/edit/:entity", "/api/edit/:entity/:id"],
};
