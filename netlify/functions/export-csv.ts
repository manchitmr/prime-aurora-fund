import type { Config } from "@netlify/functions";
import { loadAll, buildPublic } from "./_shared/shape.ts";
import { json } from "./_shared/auth.ts";

/* A leading =, +, - or @ makes Excel treat the cell as a formula. Committee
   members type these descriptions, so prefix such values with an apostrophe. */
const cell = (v: unknown) => {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const row = (cells: unknown[]) => cells.map(cell).join(",");

/** Anonymised summary CSV. Public, and carries no household names. */
export default async () => {
  try {
    const d = buildPublic(await loadAll());
    const lines: string[] = [];

    lines.push(row([`${d.societyName} — fund summary ${d.year}`]));
    lines.push(row([`Generated ${new Date().toISOString().slice(0, 10)}. Plot numbers only; no household names.`]));
    lines.push("");

    lines.push(row(["Month", "Collected (Rs.)", "Expected (Rs.)", "Rate", "Households paid", "Status"]));
    d.months.forEach((m, i) => lines.push(row([
      m, d.monthly[i], d.expectedMonthly,
      (d.expectedMonthly ? (d.monthly[i] / d.expectedMonthly) * 100 : 0).toFixed(1) + "%",
      d.paid[i], i < d.monthsDone ? "Complete" : "Not reached",
    ])));
    lines.push(row(["Total", d.collections2026, d.expectedMonthly * 12, "", "", ""]));
    lines.push("");

    lines.push(row(["Fund position", "Amount (Rs.)"]));
    lines.push(row(["2025 brought forward", d.bf]));
    lines.push(row([`Collections ${d.year}`, d.collections2026]));
    lines.push(row(["Contributions & donations", d.otherIncome]));
    lines.push(row(["Expenses", d.expenses]));
    lines.push(row(["Fund balance", d.fundBalance]));
    lines.push("");

    lines.push(row(["Month end", "Balance (Rs.)", "Basis"]));
    d.balanceSeries.forEach((b) =>
      lines.push(row([b.month, b.value, b.projected ? "Projected" : "Actual"])));
    lines.push("");

    lines.push(row(["Date", "Description", "Category", "Type", "Amount (Rs.)"]));
    d.transactions.forEach((t) =>
      lines.push(row([t.date || "", t.desc, t.cat, t.type, t.amt])));

    const stamp = new Date().toISOString().slice(0, 10);
    // BOM so Excel opens UTF-8 correctly on a double click
    return new Response("﻿" + lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="prime-aurora-summary-${stamp}.csv"`,
        "cache-control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("export-csv failed", err);
    return json({ error: "The CSV could not be generated." }, 500);
  }
};

export const config: Config = { path: "/api/export/csv" };
