import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { getShipmentView, transitionShipment } from "@/server/shipments";
import { transitionSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const id = z.uuid().parse(params.id);
  await transitionShipment(db, user, id, await body(transitionSchema), now);
  return getShipmentView(db, user, id);
});
