import { z } from "zod";
import { route } from "@/server/http";
import { getReputation } from "@/server/reviews";

export const dynamic = "force-dynamic";

/** Réputation publique d'un utilisateur : moyennes, volumes de livraisons et derniers avis (sans coordonnées). */
export const GET = route<{ id: string }>({ auth: "none" }, async ({ db, params }) => getReputation(db, z.uuid().parse(params.id)));
