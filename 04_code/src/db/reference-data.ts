import { sql } from "drizzle-orm";
import { CITIES, ENABLED_ROUTES, routeId } from "@/config/cities";
import type { Db } from "./client";
import { cities, routes } from "./schema";

/**
 * Synchronise villes et couloirs depuis `src/config/cities.ts` (upsert). Les couloirs retirés de la
 * configuration sont désactivés (enabled = false) et jamais supprimés : l'historique reste cohérent.
 */
export async function syncReferenceData(db: Db): Promise<{ cities: number; routes: number }> {
  await db.transaction(async (tx) => {
    for (const c of CITIES) {
      await tx
        .insert(cities)
        .values({ id: c.id, countryCode: c.countryCode, name: c.name, lat: c.lat ?? null, lon: c.lon ?? null, enabled: true })
        .onConflictDoUpdate({
          target: cities.id,
          set: { countryCode: c.countryCode, name: c.name, lat: c.lat ?? null, lon: c.lon ?? null, enabled: true },
        });
    }
    const wanted = ENABLED_ROUTES.map(([o, d]) => routeId(o, d));
    for (const [origin, destination] of ENABLED_ROUTES) {
      await tx
        .insert(routes)
        .values({ id: routeId(origin, destination), originCityId: origin, destinationCityId: destination, enabled: true })
        .onConflictDoUpdate({ target: routes.id, set: { enabled: true } });
    }
    await tx.execute(
      sql`UPDATE routes SET enabled = false WHERE id NOT IN (${sql.join(wanted.map((w) => sql`${w}`), sql`, `)})`,
    );
  });
  return { cities: CITIES.length, routes: ENABLED_ROUTES.length };
}
