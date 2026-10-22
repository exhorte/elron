import { requireActor, route } from "@/server/http";
import { listMyShipments } from "@/server/shipments";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async ({ db, actor }) => listMyShipments(db, requireActor(actor)));
