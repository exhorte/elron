import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Exécuteur accepté par les services : la base ou une transaction en cours. */
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __alxPool?: Pool; __alxDb?: Db };

export function getPool(): Pool {
  if (!globalForDb.__alxPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL n'est pas défini (voir .env.example)");
    globalForDb.__alxPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalForDb.__alxPool;
}

export function getDb(): Db {
  if (!globalForDb.__alxDb) globalForDb.__alxDb = drizzle(getPool(), { schema });
  return globalForDb.__alxDb;
}

export async function closeDb(): Promise<void> {
  const pool = globalForDb.__alxPool;
  globalForDb.__alxPool = undefined;
  globalForDb.__alxDb = undefined;
  if (pool) await pool.end();
}

export { schema };
