/**
 * Périmètre géographique configurable (D-007). Villes et couloirs sont synchronisés en base par
 * `npm run db:migrate` (upsert). Pour ajouter un couloir : ajouter les villes puis la paire ici.
 *
 * ⚠️ Données de référence uniquement : ces entrées n'attestent AUCUN service de transport réel.
 * Dakar ↔ Abidjan est le couloir de démonstration et de validation métier.
 */
export interface CityConfig {
  id: string; // identifiant stable, minuscule : "<pays>-<ville>"
  countryCode: string; // ISO 3166-1 alpha-2
  name: string;
  lat?: number;
  lon?: number;
}

export const CITIES: CityConfig[] = [
  { id: "sn-dakar", countryCode: "SN", name: "Dakar", lat: 14.69, lon: -17.45 },
  { id: "ci-abidjan", countryCode: "CI", name: "Abidjan", lat: 5.36, lon: -4.01 },
];

/** Couloirs activés, orientés [origine, destination]. */
export const ENABLED_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["sn-dakar", "ci-abidjan"],
  ["ci-abidjan", "sn-dakar"],
];

export function routeId(originCityId: string, destinationCityId: string): string {
  return `${originCityId}--${destinationCityId}`;
}
