import { sql } from "drizzle-orm";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "none" }, async ({ db }) => {
  await db.execute(sql`select 1`);
  return { status: "ok" };
});
