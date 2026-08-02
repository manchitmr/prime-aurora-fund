import { randomBytes } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema } from "./db.ts";
import { loadAll, buildPublic, buildPrivate } from "./shape.ts";
import {
  currentUser, requireEditor, requireAdmin,
  verifyPassword, hashPassword, issueSession, clearSession, type Editor,
} from "./auth.ts";

const ROLES = new Set(["admin", "editor"]);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const router = Router();

/* ------------------------------------------------------------------- auth */

router.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "That email and password combination was not recognised." });
  }

  issueSession(res, { id: user.id, email: user.email, name: user.name, role: user.role });
  res.json({ ok: true });
});

router.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/api/auth/me", (req, res) => {
  res.set("cache-control", "no-store");
  const user = currentUser(req);
  if (!user) return res.json({ signedIn: false, canEdit: false, canManageUsers: false });
  res.json({
    signedIn: true,
    canEdit: user.role === "editor" || user.role === "admin",
    canManageUsers: user.role === "admin",
    email: user.email,
    name: user.name,
    role: user.role,
    roles: [user.role],
  });
});

/** Preview an invite before accepting it — email/role/validity only, no auth. */
router.get("/api/invites/:token", async (req, res) => {
  const [invite] = await db.select().from(schema.invitations).where(eq(schema.invitations.token, req.params.token));
  if (!invite) return res.status(404).json({ error: "That invitation link is not valid." });
  if (invite.acceptedAt) return res.status(409).json({ error: "That invitation has already been used." });
  if (invite.expiresAt.getTime() < Date.now())
    return res.status(409).json({ error: "That invitation has expired. Ask an admin to send a new one." });
  res.json({ email: invite.email, role: invite.role });
});

/**
 * Accept an invitation: no session required, the token itself is the
 * authorisation. One-time — accepting clears the token's usability by
 * stamping acceptedAt, so a link that leaked after use is inert.
 */
router.post("/api/auth/accept-invite", async (req, res) => {
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");
  const name = req.body?.name ? String(req.body.name).trim().slice(0, 200) : null;
  if (!token) return res.status(400).json({ error: "Missing invite token." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const [invite] = await db.select().from(schema.invitations).where(eq(schema.invitations.token, token));
  if (!invite) return res.status(404).json({ error: "That invitation link is not valid." });
  if (invite.acceptedAt) return res.status(409).json({ error: "That invitation has already been used." });
  if (invite.expiresAt.getTime() < Date.now())
    return res.status(409).json({ error: "That invitation has expired. Ask an admin to send a new one." });

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  if (existing) return res.status(409).json({ error: "An account already exists for that email." });

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(schema.users)
    .values({ email: invite.email, passwordHash, name, role: invite.role })
    .returning();
  await db.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, invite.id));

  issueSession(res, { id: user.id, email: user.email, name: user.name, role: user.role });
  res.json({ ok: true });
});

/* -------------------------------------------------------------- users & invites */

router.get("/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = await db.select({
    id: schema.users.id, email: schema.users.email, name: schema.users.name,
    role: schema.users.role, createdAt: schema.users.createdAt,
  }).from(schema.users).orderBy(schema.users.email);

  const invites = await db.select().from(schema.invitations)
    .where(isNull(schema.invitations.acceptedAt))
    .orderBy(desc(schema.invitations.createdAt));

  res.set("cache-control", "no-store");
  res.json({
    users,
    invites: invites.map((i) => ({
      id: i.id, email: i.email, role: i.role,
      expiresAt: i.expiresAt, expired: i.expiresAt.getTime() < Date.now(),
      createdAt: i.createdAt,
    })),
  });
});

router.delete("/api/admin/users/:id", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = Number(req.params.id);
  if (id === admin.id) return res.status(400).json({ error: "You cannot remove your own account." });

  const [row] = await db.delete(schema.users).where(eq(schema.users.id, id)).returning();
  if (!row) return res.status(409).json({ error: "That user no longer exists." });
  await db.insert(schema.auditLog).values({
    userEmail: admin.email, action: "delete", entity: "user", entityId: String(id), detail: { email: row.email },
  });
  res.json({ ok: true });
});

router.put("/api/admin/users/:id", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = Number(req.params.id);
  const role = String(req.body?.role ?? "");
  if (!ROLES.has(role)) return res.status(400).json({ error: `Role must be one of: ${[...ROLES].join(", ")}.` });
  if (id === admin.id && role !== "admin")
    return res.status(400).json({ error: "You cannot remove your own admin access." });

  const [row] = await db.update(schema.users).set({ role }).where(eq(schema.users.id, id)).returning();
  if (!row) return res.status(409).json({ error: "That user no longer exists." });
  await db.insert(schema.auditLog).values({
    userEmail: admin.email, action: "update", entity: "user", entityId: String(id), detail: { role },
  });
  res.json({ ok: true, row: { id: row.id, email: row.email, name: row.name, role: row.role } });
});

router.post("/api/admin/invites", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const role = String(req.body?.role ?? "editor");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Enter a valid email address." });
  if (!ROLES.has(role)) return res.status(400).json({ error: `Role must be one of: ${[...ROLES].join(", ")}.` });

  const [existingUser] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existingUser) return res.status(409).json({ error: "An account already exists for that email." });

  // Superseded by this one — an old link for the same address should stop working.
  await db.delete(schema.invitations)
    .where(and(eq(schema.invitations.email, email), isNull(schema.invitations.acceptedAt)));

  const token = randomBytes(24).toString("base64url");
  const [invite] = await db.insert(schema.invitations).values({
    email, role, token, invitedBy: admin.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  }).returning();

  await db.insert(schema.auditLog).values({
    userEmail: admin.email, action: "create", entity: "invitation", entityId: String(invite.id), detail: { email, role },
  });

  const origin = `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ ok: true, inviteUrl: `${origin}/editor?invite=${token}`, expiresAt: invite.expiresAt });
});

router.delete("/api/admin/invites/:id", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const [row] = await db.delete(schema.invitations).where(eq(schema.invitations.id, Number(req.params.id))).returning();
  if (!row) return res.status(409).json({ error: "That invitation no longer exists." });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- data */

router.get("/api/public-data", async (_req, res) => {
  try {
    const raw = await loadAll();
    res.set("cache-control", "public, max-age=30, stale-while-revalidate=300");
    res.json(buildPublic(raw));
  } catch (err) {
    console.error("public-data failed", err);
    res.status(500).json({ error: "Could not load the dashboard data." });
  }
});

router.get("/api/admin/data", async (req, res) => {
  const editor = requireEditor(req, res);
  if (!editor) return;

  try {
    const [raw, recent] = await Promise.all([
      loadAll(),
      db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(30),
    ]);
    res.set("cache-control", "no-store");
    res.json({ ...buildPrivate(raw), signedInAs: editor.email, audit: recent });
  } catch (err) {
    console.error("admin-data failed", err);
    res.status(500).json({ error: "Could not load the editor data." });
  }
});

/* ------------------------------------------------------------------ exports */

/* A leading =, +, - or @ makes Excel treat the cell as a formula. Committee
   members type these descriptions, so prefix such values with an apostrophe. */
const cell = (v: unknown) => {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvRow = (cells: unknown[]) => cells.map(cell).join(",");

router.get("/api/export/csv", async (_req, res) => {
  try {
    const d = buildPublic(await loadAll());
    const lines: string[] = [];

    lines.push(csvRow([`${d.societyName} — fund summary ${d.year}`]));
    lines.push(csvRow([`Generated ${new Date().toISOString().slice(0, 10)}. Plot numbers only; no household names.`]));
    lines.push("");

    lines.push(csvRow(["Month", "Collected (Rs.)", "Expected (Rs.)", "Rate", "Households paid", "Status"]));
    d.months.forEach((m, i) => lines.push(csvRow([
      m, d.monthly[i], d.expectedMonthly,
      (d.expectedMonthly ? (d.monthly[i] / d.expectedMonthly) * 100 : 0).toFixed(1) + "%",
      d.paid[i], i < d.monthsDone ? "Complete" : "Not reached",
    ])));
    lines.push(csvRow(["Total", d.collections2026, d.expectedMonthly * 12, "", "", ""]));
    lines.push("");

    lines.push(csvRow(["Fund position", "Amount (Rs.)"]));
    lines.push(csvRow(["2025 brought forward", d.bf]));
    lines.push(csvRow([`Collections ${d.year}`, d.collections2026]));
    lines.push(csvRow(["Contributions & donations", d.otherIncome]));
    lines.push(csvRow(["Expenses", d.expenses]));
    lines.push(csvRow(["Fund balance", d.fundBalance]));
    lines.push("");

    lines.push(csvRow(["Month end", "Balance (Rs.)", "Basis"]));
    d.balanceSeries.forEach((b) =>
      lines.push(csvRow([b.month, b.value, b.projected ? "Projected" : "Actual"])));
    lines.push("");

    lines.push(csvRow(["Date", "Description", "Category", "Type", "Amount (Rs.)"]));
    d.transactions.forEach((t) =>
      lines.push(csvRow([t.date || "", t.desc, t.cat, t.type, t.amt])));

    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="prime-aurora-summary-${stamp}.csv"`,
      "cache-control": "public, max-age=60",
    });
    // BOM so Excel opens UTF-8 correctly on a double click
    res.send("﻿" + lines.join("\r\n"));
  } catch (err) {
    console.error("export-csv failed", err);
    res.status(500).json({ error: "The CSV could not be generated." });
  }
});

const HEADER_FILL = "FF1F4E5F";
const TOTAL_FILL = "FFE7EEF1";
const MONEY = '#,##0.00;(#,##0.00);-';
const INT = '#,##0;(#,##0);-';

router.get("/api/export/xlsx", async (req, res) => {
  const editor = requireEditor(req, res);
  if (!editor) return;

  try {
    const raw = await loadAll();
    const d = buildPrivate(raw);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Prime Aurora Welfare Society";
    wb.created = new Date();

    const head = (ws: ExcelJS.Worksheet, row: number) => {
      const r = ws.getRow(row);
      r.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      r.alignment = { horizontal: "center", wrapText: true };
    };

    /* ---------------------------------------------------------- Summary */
    const s = wb.addWorksheet("Summary");
    s.columns = [{ width: 46 }, { width: 18 }, { width: 16 }, { width: 15 }, { width: 13 }];
    s.getCell("A1").value = `${d.societyName} — Fund Summary ${d.year}`;
    s.getCell("A1").font = { name: "Arial", size: 13, bold: true };

    s.getRow(3).values = ["Item", "Amount (Rs.)"];
    head(s, 3);
    const summaryRows: [string, number][] = [
      ["2025 Deposits Brought Forward", d.bf],
      [`Monthly Collections ${d.year}`, d.collections2026],
      ["Contributions & Donations", d.otherIncome],
      ["Expenses", d.expenses],
    ];
    summaryRows.forEach(([label, val], i) => {
      const r = s.getRow(4 + i);
      r.values = [label, val];
      r.getCell(2).numFmt = MONEY;
    });
    const bal = s.getRow(8);
    bal.values = ["FUND BALANCE", d.fundBalance];
    bal.font = { name: "Arial", size: 10, bold: true };
    bal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    bal.getCell(2).numFmt = MONEY;

    s.getRow(10).values = ["Month", "Collected (Rs.)", "Expected (Rs.)", "Rate", "Houses Paid", "Status"];
    head(s, 10);
    d.months.forEach((m, i) => {
      const r = s.getRow(11 + i);
      const done = i < d.monthsDone;
      r.values = [
        m, d.monthly[i], d.expectedMonthly,
        d.expectedMonthly ? d.monthly[i] / d.expectedMonthly : 0,
        d.paid[i],
        done ? "Complete" : "Not reached — advance only",
      ];
      r.getCell(2).numFmt = INT;
      r.getCell(3).numFmt = INT;
      r.getCell(4).numFmt = "0.0%";
    });

    s.getRow(25).values = ["Year-End Projection (indicative)"];
    s.getRow(25).font = { name: "Arial", size: 11, bold: true };
    [["Avg monthly collection (completed months)", d.avgColl],
     ["Avg monthly expense (completed months)", d.avgExp],
     ["Advance payments already received", d.advance],
     ["Projected additional net inflow", d.projInflow],
     ["Projected 31 Dec balance", d.projBalance]].forEach(([l, v], i) => {
      const r = s.getRow(26 + i);
      r.values = [l, v];
      r.getCell(2).numFmt = MONEY;
    });

    /* ------------------------------------------------------ Collections */
    const c = wb.addWorksheet("Collections");
    c.columns = [
      { width: 10 }, { width: 32 }, { width: 14 }, { width: 16 },
      ...d.months.map(() => ({ width: 13 })), { width: 14 },
    ];
    c.getRow(1).values = ["Plot", "Household", "Status", "2025 b/f",
      ...d.months.map((m) => `${m} (Rs.)`), "Total (Rs.)"];
    head(c, 1);
    d.plotRegister.forEach((p, i) => {
      const r = c.getRow(2 + i);
      const total = p.months.reduce((a, b) => a + b, 0) + (p.bf || 0);
      r.values = [p.house, p.owner || "", p.status, p.bf,
        ...p.months.map((v) => v || null), total];
      for (let col = 4; col <= 17; col++) r.getCell(col).numFmt = INT;
    });
    c.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
    c.autoFilter = { from: "A1", to: { row: d.plotRegister.length + 1, column: 17 } };

    /* ---------------------------------------------------- Transactions */
    const t = wb.addWorksheet("Contributions & Expenses");
    t.columns = [{ width: 12 }, { width: 38 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 40 }];
    t.getRow(1).values = ["Date", "Description", "Category", "Type", "Amount (Rs.)", "Notes"];
    head(t, 1);
    d.transactions.forEach((x, i) => {
      const r = t.getRow(2 + i);
      r.values = [x.date || "", x.desc, x.cat, x.type, x.amt, x.note || ""];
      r.getCell(5).numFmt = MONEY;
    });
    const tTot = t.getRow(d.transactions.length + 2);
    tTot.values = ["", "NET", "", "", d.otherIncome + d.expenses, ""];
    tTot.font = { name: "Arial", size: 10, bold: true };
    tTot.getCell(5).numFmt = MONEY;

    /* --------------------------------------------------------- Projects */
    const p = wb.addWorksheet("Projects");
    p.columns = [{ width: 34 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 40 }];
    p.getRow(1).values = ["Project", "Priority", "Status", "Estimated cost", "Saved", "Note"];
    head(p, 1);
    d.projects.forEach((x, i) => {
      const r = p.getRow(2 + i);
      r.values = [x.name, x.priority, x.status, x.cost, x.saved, x.note || ""];
      r.getCell(4).numFmt = INT;
      r.getCell(5).numFmt = INT;
    });

    /* --------------------------------------------------------- Settings */
    const g = wb.addWorksheet("Settings");
    g.columns = [{ width: 30 }, { width: 16 }, { width: 50 }];
    g.getRow(1).values = ["Setting", "Value", "Note"];
    head(g, 1);
    d.settings.forEach((x, i) => {
      g.getRow(2 + i).values = [x.key, x.value, x.note || ""];
    });

    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="prime-aurora-fund-${d.year}-${stamp}.xlsx"`,
      "cache-control": "no-store",
    });
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error("export-xlsx failed", err);
    res.status(500).json({ error: "The workbook could not be generated." });
  }
});

/* -------------------------------------------------------------------- edit */

/* Contribution and Donation are both inflows; only the label and the reporting
   split differ. "Income" is still accepted so an older client or a bookmarked
   request cannot start failing mid-session — it is normalised on the way in. */
const TYPES = new Set(["Contribution", "Donation", "Expense"]);
const TYPE_ALIASES: Record<string, string> = { Income: "Contribution" };
const STATUSES = new Set(["Occupied", "Unregistered", "Pending", "Bare Land", "Vacant House"]);

class Invalid extends Error {}

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

function nullableMoney(v: unknown, field: string) {
  const n = money(v, field, { required: false });
  return n == null ? null : String(n);
}

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

router.all("/api/edit/:entity/:id?", async (req, res) => {
  const editor = requireEditor(req, res);
  if (!editor) return;

  const { entity, id } = req.params;
  const method = req.method.toUpperCase();
  const body = method === "DELETE" ? {} : (req.body ?? {});

  try {
    switch (entity) {
      case "transactions": return await transactions(method, id, body, editor, res);
      case "projects":     return await projects(method, id, body, editor, res);
      case "settings":     return await setting(method, id, body, editor, res);
      case "collections":  return await collection(method, body, editor, res);
      case "plots":        return await plot(method, id, body, editor, res);
      default:
        return res.status(400).json({ error: `Unknown resource '${entity}'.` });
    }
  } catch (err) {
    if (err instanceof Invalid) return res.status(400).json({ error: err.message });
    console.error("edit failed", entity, method, err);
    res.status(500).json({ error: "The change could not be saved." });
  }
});

async function transactions(method: string, id: string | undefined, b: any, editor: Editor, res: any) {
  if (method === "POST" || method === "PUT") {
    const raw = str(b.type, "Type")!;
    const type = TYPE_ALIASES[raw] ?? raw;
    if (!TYPES.has(type))
      throw new Invalid(`Type must be one of: ${[...TYPES].join(", ")}.`);

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
      return res.status(201).json({ ok: true, row });
    }
    if (!id) throw new Invalid("Missing transaction id.");
    const [row] = await db.update(schema.transactions).set(values)
      .where(eq(schema.transactions.id, Number(id))).returning();
    if (!row) return res.status(409).json({ error: "That transaction no longer exists." });
    await audit(editor, "update", "transaction", id, values);
    return res.json({ ok: true, row });
  }

  if (method === "DELETE") {
    if (!id) throw new Invalid("Missing transaction id.");
    const [row] = await db.delete(schema.transactions)
      .where(eq(schema.transactions.id, Number(id))).returning();
    if (!row) return res.status(409).json({ error: "That transaction no longer exists." });
    await audit(editor, "delete", "transaction", id, row);
    return res.json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed." });
}

async function projects(method: string, id: string | undefined, b: any, editor: Editor, res: any) {
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
      return res.status(201).json({ ok: true, row });
    }
    if (!id) throw new Invalid("Missing project id.");
    const [row] = await db.update(schema.projects).set(values)
      .where(eq(schema.projects.id, Number(id))).returning();
    if (!row) return res.status(409).json({ error: "That project no longer exists." });
    await audit(editor, "update", "project", id, values);
    return res.json({ ok: true, row });
  }

  if (method === "DELETE") {
    if (!id) throw new Invalid("Missing project id.");
    const [row] = await db.delete(schema.projects)
      .where(eq(schema.projects.id, Number(id))).returning();
    if (!row) return res.status(409).json({ error: "That project no longer exists." });
    await audit(editor, "delete", "project", id, row);
    return res.json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed." });
}

async function setting(method: string, key: string | undefined, b: any, editor: Editor, res: any) {
  if (method !== "PUT") return res.status(405).json({ error: "Method not allowed." });
  if (!key) throw new Invalid("Missing setting key.");

  const value = str(b.value, "Value", { max: 200 })!;

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
  if (!row) return res.status(400).json({ error: `Unknown setting '${key}'.` });
  await audit(editor, "update", "setting", key, { value });
  return res.json({ ok: true, row });
}

/** Upsert one plot-month cell. Zero or blank clears it. */
async function collection(method: string, b: any, editor: Editor, res: any) {
  if (method !== "PUT") return res.status(405).json({ error: "Method not allowed." });

  const houseNo = str(b.house, "Plot", { max: 20 })!;
  const year = Math.trunc(Number(b.year));
  const month = Math.trunc(Number(b.month));
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Invalid("Year is out of range.");
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Invalid("Month must be 1 to 12.");

  const [exists] = await db.select().from(schema.plots).where(eq(schema.plots.houseNo, houseNo));
  if (!exists) return res.status(400).json({ error: `Unknown plot '${houseNo}'.` });

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
    return res.json({ ok: true, amount: 0 });
  }

  await db
    .insert(schema.collections)
    .values({ houseNo, year, month, amount: String(amount) })
    .onConflictDoUpdate({
      target: [schema.collections.houseNo, schema.collections.year, schema.collections.month],
      set: { amount: String(amount) },
    });
  await audit(editor, "update", "collection", `${houseNo}/${year}-${month}`, { amount });
  return res.json({ ok: true, amount });
}

async function plot(method: string, houseNo: string | undefined, b: any, editor: Editor, res: any) {
  if (method !== "PUT") return res.status(405).json({ error: "Method not allowed." });
  if (!houseNo) throw new Invalid("Missing plot number.");

  const status = str(b.status, "Status", { max: 30 })!;
  if (!STATUSES.has(status))
    throw new Invalid(`Status must be one of: ${[...STATUSES].join(", ")}.`);

  const values: Record<string, unknown> = {
    owner: str(b.owner, "Owner", { max: 200, required: false }),
    status,
    bf2025: nullableMoney(b.bf, "2025 balance"),
  };

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
  if (!row) return res.status(400).json({ error: `Unknown plot '${houseNo}'.` });

  await audit(editor, "update", "plot", houseNo,
    values.houseNo ? { ...values, renumberedFrom: houseNo } : values);
  return res.json({ ok: true, row, renumbered: values.houseNo ? renumberTo : null });
}
