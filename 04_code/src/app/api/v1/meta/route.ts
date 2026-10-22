import { GOODS_CATEGORIES, GOODS_POLICY_VALIDATED, GOODS_POLICY_VERSION } from "@/config/goods-policy";
import { CURRENCIES } from "@/domain/money";
import { listEnabledRoutes } from "@/server/geo";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Référentiels publics nécessaires aux formulaires : couloirs ouverts, catégories, devises. */
export const GET = route({ auth: "none" }, async ({ db }) => ({
  routes: await listEnabledRoutes(db),
  goodsCategories: GOODS_CATEGORIES,
  goodsPolicy: { version: GOODS_POLICY_VERSION, validatedLegally: GOODS_POLICY_VALIDATED },
  currencies: Object.entries(CURRENCIES).map(([code, c]) => ({ code, exponent: c.exponent, label: c.label })),
  transportModes: ["air", "bus", "car", "train", "other"],
}));
