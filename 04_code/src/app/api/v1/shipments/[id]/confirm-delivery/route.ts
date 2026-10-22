import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { confirmDelivery, getShipmentView } from "@/server/shipments";
import { confirmDeliverySchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const id = z.uuid().parse(params.id);
  const { code } = await body(confirmDeliverySchema);
  await confirmDelivery(db, user, id, code, now);
  return getShipmentView(db, user, id);
});
