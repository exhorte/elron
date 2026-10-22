import { route } from "@/server/http";
import { searchOffers } from "@/server/search";
import { searchQuerySchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Recherche publique d'offres compatibles, classées par score transparent (voir docs/API.md). */
export const GET = route({ auth: "optional" }, async ({ db, actor, query, now }) =>
  searchOffers(db, actor, query(searchQuerySchema), now),
);
