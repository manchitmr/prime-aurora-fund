/**
 * Create or reset an editor account. There is no self-serve invite/recovery
 * flow, so this is how the committee's small, known set of editors gets
 * onboarded or a forgotten password gets reset.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/create-user.ts <email> <password> [name] [role]
 */
import "dotenv/config";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.ts";

async function main() {
  const [email, password, name, role = "editor"] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> <password> [name] [role]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  if (!["admin", "editor"].includes(role)) {
    console.error(`Role must be "admin" or "editor", got "${role}".`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool, schema });

  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail));

  if (existing) {
    await db.update(schema.users)
      .set({ passwordHash, name: name ?? existing.name, role })
      .where(eq(schema.users.email, normalizedEmail));
    console.log(`Updated ${normalizedEmail} (role: ${role}).`);
  } else {
    await db.insert(schema.users).values({ email: normalizedEmail, passwordHash, name, role });
    console.log(`Created ${normalizedEmail} (role: ${role}).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
