import { and, eq } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import { invalid } from "./errors";

const { cities, routes } = schema;

export interface RouteView {
  id: string;
  origin: { id: string; name: string; countryCode: string };
  destination: { id: string; name: string; countryCode: string };
}

export async function cityNames(db: DbOrTx): Promise<Map<string, { name: string; countryCode: string }>> {
  const rows = await db.select().from(cities);
  return new Map(rows.map((c) => [c.id, { name: c.name, countryCode: c.countryCode }]));
}

export async function listEnabledRoutes(db: DbOrTx): Promise<RouteView[]> {
  const names = await cityNames(db);
  const rows = await db.select().from(routes).where(eq(routes.enabled, true));
  return rows
    .map((r) => ({
      id: r.id,
      origin: { id: r.originCityId, ...names.get(r.originCityId)! },
      destination: { id: r.destinationCityId, ...names.get(r.destinationCityId)! },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Couloir activé pour cette paire de villes, sinon erreur explicite (le périmètre est configurable). */
export async function requireEnabledRoute(db: DbOrTx, originCityId: string, destinationCityId: string) {
  const [route] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.originCityId, originCityId), eq(routes.destinationCityId, destinationCityId), eq(routes.enabled, true)))
    .limit(1);
  if (!route) throw invalid("route_not_enabled", "Ce couloir n'est pas ouvert sur la plateforme");
  return route;
}
