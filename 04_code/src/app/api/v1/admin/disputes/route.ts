import { listOpenDisputes } from "@/server/disputes";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "operator" }, async ({ db, actor }) => listOpenDisputes(db, requireActor(actor)));
