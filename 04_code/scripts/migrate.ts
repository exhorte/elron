/**
 * Applique les migrations SQL (drizzle/) puis synchronise le référentiel géographique.
 * Usage : npm run db:migrate   (utilise DATABASE_URL)
 */
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/db/client";
import { syncReferenceData } from "../src/db/reference-data";

async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  const counts = await syncReferenceData(db);
  console.log(`Migrations appliquées. Référentiel : ${counts.cities} villes, ${counts.routes} couloirs.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
