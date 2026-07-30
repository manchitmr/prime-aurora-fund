import { asc } from "drizzle-orm";
import { db, schema } from "./db.ts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const num = (v: unknown) => (v == null ? 0 : Number(v));

export type Raw = Awaited<ReturnType<typeof loadAll>>;

export async function loadAll() {
  const [plots, collections, transactions, projects, settingRows] = await Promise.all([
    db.select().from(schema.plots).orderBy(asc(schema.plots.sortOrder)),
    db.select().from(schema.collections),
    db.select().from(schema.transactions).orderBy(asc(schema.transactions.txDate)),
    db.select().from(schema.projects).orderBy(asc(schema.projects.sortOrder)),
    db.select().from(schema.settings),
  ]);

  const settings: Record<string, string> = {};
  for (const s of settingRows) settings[s.key] = s.value;

  return { plots, collections, transactions, projects, settings, settingRows };
}

/**
 * Everything the dashboard needs that is NOT personal data.
 *
 * Owner names are never read here. The public payload is assembled from plot
 * numbers only, so there is no code path in which a name reaches an
 * unauthenticated caller — this is deliberately not a "delete the field"
 * filter, which is the pattern that tends to leak when a field is added later.
 */
export function buildPublic(raw: Raw) {
  const { plots, collections, transactions, projects, settings } = raw;

  const fee = Number(settings.monthly_fee ?? 3000);
  const monthsDone = Math.min(12, Math.max(0, Number(settings.months_completed ?? 0)));
  const year = Number(settings.current_year ?? 2026);

  const occupiedPlots = plots.filter((p) => p.status === "Occupied");
  const occupied = occupiedPlots.length;
  const expectedMonthly = fee * occupied;

  // per-plot month grid, keyed by plot number only
  const byPlot = new Map<string, number[]>();
  for (const p of plots) byPlot.set(p.houseNo, new Array(12).fill(0));
  for (const c of collections) {
    if (c.year !== year) continue;
    const row = byPlot.get(c.houseNo);
    if (row) row[c.month - 1] += num(c.amount);
  }

  const monthly = new Array(12).fill(0);
  const paid = new Array(12).fill(0);
  for (const row of byPlot.values()) {
    for (let m = 0; m < 12; m++) {
      if (row[m] > 0) { monthly[m] += row[m]; paid[m] += 1; }
    }
  }

  const bf = plots.reduce((s, p) => s + num(p.bf2025), 0);
  const collectionsTotal = monthly.reduce((s, v) => s + v, 0);

  let otherIncome = 0, expenses = 0;
  for (const t of transactions) {
    if (t.type === "Income") otherIncome += num(t.amount);
    else if (t.type === "Expense") expenses += num(t.amount);
  }
  const fundBalance = bf + collectionsTotal + otherIncome + expenses;

  const ytdColl = monthly.slice(0, monthsDone).reduce((s, v) => s + v, 0);
  const ytdExp = expectedMonthly * monthsDone;

  const statusCounts: Record<string, number> = {};
  for (const p of plots) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  const zeroPayers: { house: string }[] = [];
  let fullPayers = 0;
  for (const p of occupiedPlots) {
    const row = byPlot.get(p.houseNo)!;
    const total = row.reduce((s, v) => s + v, 0);
    if (total === 0) zeroPayers.push({ house: p.houseNo });
    else if (monthsDone > 0 && row.slice(0, monthsDone).every((v) => v > 0)) fullPayers += 1;
  }

  const top = occupiedPlots
    .map((p) => {
      const row = byPlot.get(p.houseNo)!;
      return {
        house: p.houseNo,
        tot: row.reduce((s, v) => s + v, 0) + num(p.bf2025),
        months: row.filter((v) => v > 0).length,
      };
    })
    .filter((h) => h.tot > 0)
    .sort((a, b) => b.tot - a.tot)
    .slice(0, 12);

  const avgColl = monthsDone > 0 ? ytdColl / monthsDone : 0;
  const avgExp = monthsDone > 0 ? -expenses / monthsDone : 0;
  const advance = monthly.slice(monthsDone).reduce((s, v) => s + v, 0);
  const projInflow = (avgColl - avgExp) * (12 - monthsDone) - advance;

  return {
    societyName: settings.society_name ?? "Prime Aurora Welfare Society",
    year, months: MONTHS, monthsDone, fee,
    plots: plots.length, occupied, statusCounts,
    monthly, paid, expectedMonthly,
    bf, collections2026: collectionsTotal,
    otherIncome: round2(otherIncome),
    expenses: round2(expenses),
    fundBalance: round2(fundBalance),
    ytdColl, ytdExp, arrears: ytdExp - ytdColl,
    zeroPayers, fullPayers,
    partialPayers: occupied - zeroPayers.length - fullPayers,
    top,
    avgColl: round2(avgColl), avgExp: round2(avgExp), advance,
    projInflow: round2(projInflow),
    projBalance: round2(fundBalance + projInflow),
    // ledger descriptions are committee-authored; they are shown publicly, so
    // the editor UI warns against putting personal names in them
    transactions: transactions.map((t) => ({
      id: t.id, date: t.txDate, desc: t.description,
      cat: t.category, type: t.type, amt: num(t.amount), note: t.notes,
    })),
    projects: projects.map((p) => ({
      id: p.id, name: p.name, priority: p.priority,
      cost: p.estimatedCost == null ? null : num(p.estimatedCost),
      quotations: p.quotationsReceived,
      saved: p.saved == null ? null : num(p.saved),
      status: p.status, note: p.note,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/** Public payload plus the personal data. Authenticated callers only. */
export function buildPrivate(raw: Raw) {
  const pub = buildPublic(raw);
  const year = pub.year;

  const grid = new Map<string, number[]>();
  for (const p of raw.plots) grid.set(p.houseNo, new Array(12).fill(0));
  for (const c of raw.collections) {
    if (c.year !== year) continue;
    grid.get(c.houseNo)?.splice(c.month - 1, 1, num(c.amount));
  }

  return {
    ...pub,
    plotRegister: raw.plots.map((p) => ({
      house: p.houseNo,
      owner: p.owner,
      status: p.status,
      bf: p.bf2025 == null ? null : num(p.bf2025),
      months: grid.get(p.houseNo)!,
    })),
    settings: raw.settingRows.map((s) => ({ key: s.key, value: s.value, note: s.note })),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
