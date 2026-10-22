import type { CityOption } from "@/components/search-form";
import { CITIES } from "@/config/cities";
import type { RouteView } from "@/server/geo";

/** Villes distinctes des couloirs ouverts, pour alimenter les listes déroulantes. */
export function citiesFromRoutes(routes: RouteView[]): CityOption[] {
  const map = new Map<string, CityOption>();
  for (const r of routes) {
    map.set(r.origin.id, { id: r.origin.id, name: r.origin.name });
    map.set(r.destination.id, { id: r.destination.id, name: r.destination.name });
  }
  // Ordre de la configuration (Dakar avant Abidjan) : le couloir de démonstration est présélectionné.
  const order = CITIES.map((c) => c.id);
  return [...map.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
