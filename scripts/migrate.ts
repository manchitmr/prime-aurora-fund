import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "name" text PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM "_migrations"')).rows.map((r) => r.name),
  );

  // Older migrations are nested folders (name/migration.sql, from the old
  // Netlify DB tooling); `npm run db:generate` going forward produces flat
  // top-level .sql files (drizzle-kit's default). Support both.
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const names = [
    ...entries.filter((d) => d.isDirectory()).map((d) => d.name),
    ...entries.filter((d) => d.isFile() && d.name.endsWith(".sql")).map((d) => d.name),
  ].sort();

  for (const name of names) {
    if (applied.has(name)) continue;
    const filePath = name.endsWith(".sql")
      ? path.join(MIGRATIONS_DIR, name)
      : path.join(MIGRATIONS_DIR, name, "migration.sql");
    const sql = readFileSync(filePath, "utf8");
    console.log(`Applying ${name}...`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query('INSERT INTO "_migrations" (name) VALUES ($1)', [name]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log("Migrations up to date.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
