import { afterAll } from "vitest";

// Doit s'exécuter avant tout import de `@/db/client` : les tests n'utilisent JAMAIS la base de développement.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://alx:alx@localhost:5433/alx_test";
process.env.SCRYPT_N = "1024"; // hachage rapide pour les tests (le coût est encodé dans chaque hash)
process.env.PLATFORM_FEE_BPS = "0";
delete process.env.ALX_SHOW_DEMO;
delete process.env.ALX_MATCHING_WEIGHTS;
delete process.env.TRUSTED_PROXY_HOPS;

afterAll(async () => {
  const { closeDb } = await import("../src/db/client");
  await closeDb();
});
