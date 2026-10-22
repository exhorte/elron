import { z } from "zod";
import { getOfferView } from "@/server/offers";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "none" }, async ({ db, params }) => {
  const id = z.uuid().parse(params.id);
  return getOfferView(db, id);
});
