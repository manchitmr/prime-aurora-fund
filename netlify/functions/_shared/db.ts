import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "../../../db/schema.ts";

export const db = drizzle({ schema });
export { schema };
