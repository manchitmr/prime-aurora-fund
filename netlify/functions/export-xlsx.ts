import type { Config } from "@netlify/functions";
import ExcelJS from "exceljs";
import { loadAll, buildPrivate } from "./_shared/shape.ts";
import { requireEditor, json } from "./_shared/auth.ts";

const HEADER_FILL = "FF1F4E5F";
const TOTAL_FILL = "FFE7EEF1";
const MONEY = '#,##0.00;(#,##0.00);-';
const INT = '#,##0;(#,##0);-';

/**
 * Full workbook, including household names — editors only.
 *
 * This is the committee's record, so it deliberately mirrors the layout of the
 * original spreadsheet rather than inventing a new one: anyone who worked from
 * the old file can still read this.
 */
export default async () => {
  const editor = await requireEditor();
  if (editor instanceof Response) return editor;

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
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="prime-aurora-fund-${d.year}-${stamp}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("export-xlsx failed", err);
    return json({ error: "The workbook could not be generated." }, 500);
  }
};

export const config: Config = { path: "/api/export/xlsx" };
