/**
 * Politique INTERNE de la plateforme sur les catégories de marchandises (D-009).
 *
 * ⚠️ Ce n'est PAS une règle douanière ni juridique. Elle n'a fait l'objet d'aucune validation
 * professionnelle (GOODS_POLICY_VALIDATED = false) et ne doit pas être présentée comme conforme.
 * - allowed    : peut être proposé par un transporteur qui l'accepte explicitement
 * - review     : déclaration + vérification à la remise requises ; le transporteur doit opter explicitement
 * - prohibited : jamais publiable ni réservable
 * Observation de départ : le PDF de recherche montre des tarifs « spéciaux » pour enveloppes, électronique,
 * cosmétiques, produits pharmaceutiques, bijoux et perruques (DS-01).
 */
export const GOODS_POLICY_VERSION = "2026-10-22-draft";
export const GOODS_POLICY_VALIDATED = false;

export type GoodsPolicy = "allowed" | "review" | "prohibited";

export const GOODS_CATEGORIES = [
  { code: "clothing", label: "Vêtements, chaussures, textile", policy: "allowed" },
  { code: "books_misc", label: "Livres et articles divers non réglementés", policy: "allowed" },
  { code: "documents", label: "Documents, enveloppes", policy: "review" },
  { code: "food_dry", label: "Denrées alimentaires sèches", policy: "review" },
  { code: "cosmetics_hair", label: "Cosmétiques, produits capillaires, perruques", policy: "review" },
  { code: "electronics", label: "Électronique", policy: "review" },
  { code: "jewelry_valuables", label: "Bijoux et objets de valeur", policy: "review" },
  { code: "medicines", label: "Médicaments et produits pharmaceutiques", policy: "review" },
  { code: "weapons_ammunition", label: "Armes et munitions", policy: "prohibited" },
  { code: "explosives_hazardous", label: "Explosifs, inflammables, matières dangereuses", policy: "prohibited" },
  { code: "illicit_drugs", label: "Stupéfiants", policy: "prohibited" },
  { code: "cash_bearer_instruments", label: "Espèces et titres au porteur", policy: "prohibited" },
  { code: "counterfeit_goods", label: "Contrefaçons", policy: "prohibited" },
] as const satisfies ReadonlyArray<{ code: string; label: string; policy: GoodsPolicy }>;

export type GoodsCategoryCode = (typeof GOODS_CATEGORIES)[number]["code"];

const BY_CODE = new Map<string, (typeof GOODS_CATEGORIES)[number]>(GOODS_CATEGORIES.map((c) => [c.code, c]));

export const GOODS_CATEGORY_CODES = GOODS_CATEGORIES.map((c) => c.code) as [GoodsCategoryCode, ...GoodsCategoryCode[]];

export function isGoodsCategory(code: string): code is GoodsCategoryCode {
  return BY_CODE.has(code);
}

export function categoryPolicy(code: string): GoodsPolicy | null {
  return BY_CODE.get(code)?.policy ?? null;
}

export function categoryLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}

/** Catégories qu'un transporteur peut déclarer accepter (tout sauf `prohibited`). */
export const OFFERABLE_CATEGORIES = GOODS_CATEGORIES.filter((c) => c.policy !== "prohibited");
