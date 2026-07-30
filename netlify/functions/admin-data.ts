import type { Config } from "@netlify/functions";
import { desc } from "drizzle-orm";
import { db, schema } from "./_shared/db.ts";
import { loadAll, buildPrivate } from "./_shared/shape.ts";
import { requireEditor, json } from "./_shared/auth.ts";

/** Full payload including household names. Editors only. */
export default async () => {
  const editor = await requireEditor();
  if (editor instanceof Response) return editor;

  try {
    const [raw, recent] = await Promise.all([
      loadAll(),
      db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(30),
    ]);
    return json(
      { ...buildPrivate(raw), signedInAs: editor.email, audit: recent },
      200,
      { "cache-control": "no-store" },
    );
  } catch (err) {
    console.error("admin-data failed", err);
    return json({ error: "Could not load the editor data." }, 500);
  }
};

export const config: Config = { path: "/api/admin/data" };
