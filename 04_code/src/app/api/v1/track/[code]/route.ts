import { route } from "@/server/http";
import { trackPublic } from "@/server/shipments";

export const dynamic = "force-dynamic";

/** Suivi public par code : sans compte, sans donnée personnelle. */
export const GET = route<{ code: string }>({ auth: "none" }, async ({ db, params }) => trackPublic(db, params.code));
