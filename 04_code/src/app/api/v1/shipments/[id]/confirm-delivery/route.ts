import { z } from "zod";
import { RATE_POLICIES } from "@/config/rate-limits";
import { requireActor, route } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { confirmDelivery, getShipmentView } from "@/server/shipments";
import { confirmDeliverySchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const id = z.uuid().parse(params.id);
  // Plafond par utilisateur, tous colis confondus : en plus des 5 essais par code, empêche de tester
  // en masse des codes sur de nombreux colis.
  await enforceRateLimit(db, RATE_POLICIES.confirmDeliveryUser, user.id, now);
  const { code } = await body(confirmDeliverySchema);
  await confirmDelivery(db, user, id, code, now);
  return getShipmentView(db, user, id);
});
