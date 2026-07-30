import type { Config } from "@netlify/functions";
import { loadAll, buildPublic } from "./_shared/shape.ts";
import { json } from "./_shared/auth.ts";

/** Anonymised dashboard payload. No authentication, no personal data. */
export default async () => {
  try {
    const raw = await loadAll();
    return json(buildPublic(raw), 200, {
      "cache-control": "public, max-age=30, stale-while-revalidate=300",
    });
  } catch (err) {
    console.error("public-data failed", err);
    return json({ error: "Could not load the dashboard data." }, 500);
  }
};

export const config: Config = { path: "/api/public-data" };
