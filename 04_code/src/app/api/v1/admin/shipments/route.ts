import { listAllShipments } from "@/server/admin";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "operator" }, async ({ db, actor }) => listAllShipments(db, requireActor(actor)));
