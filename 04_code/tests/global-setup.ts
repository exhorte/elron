import { rm as removePath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { syncReferenceData } from "../src/db/reference-data";
import * as schema from "../src/db/schema";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://alx:alx@localhost:5433/alx_test";

/**
 * Prépare la base de test : crée `*_test` si besoin, applique TOUTES les migrations (ce qui teste aussi
 * les migrations), synchronise le référentiel. Refuse de s'exécuter sur une base dont le nom ne finit
 * pas par `_test` (les tests vident les tables).
 */
export default async function setup() {
  const url = new URL(TEST_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`TEST_DATABASE_URL doit cibler une base dont le nom finit par "_test" (reçu : ${dbName})`);
  }

  const adminUrl = new URL(TEST_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  } catch (err) {
    throw new Error(`Base PostgreSQL injoignable (${adminUrl.host}). Lancez « npm run db:up ». Détail : ${(err as Error).message}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: TEST_URL, max: 2 });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
    await syncReferenceData(db);
  } finally {
    await pool.end();
  }
}

/** Efface le dossier temporaire des fichiers téléversés pendant les tests (nom fixe, dans le dossier temporaire du système). */
export async function teardown() {
  await removePath(path.join(os.tmpdir(), "alx-test-uploads"), { recursive: true, force: true });
}
