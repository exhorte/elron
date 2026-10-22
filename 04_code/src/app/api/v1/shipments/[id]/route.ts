import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { getShipmentView } from "@/server/shipments";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) =>
  getShipmentView(db, requireActor(actor), z.uuid().parse(params.id)),
);
