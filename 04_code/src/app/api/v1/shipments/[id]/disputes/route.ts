import { z } from "zod";
import { RATE_POLICIES } from "@/config/rate-limits";
import { listShipmentDisputes, openDispute } from "@/server/disputes";
import { HttpResult, requireActor, route } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { openDisputeSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) =>
  listShipmentDisputes(db, requireActor(actor), z.uuid().parse(params.id)),
);

/** Ouvre un litige et fait passer le colis à DISPUTED. Parties du colis ou opérateur ; selon les transitions autorisées par le workflow. */
export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const shipmentId = z.uuid().parse(params.id);
  await enforceRateLimit(db, RATE_POLICIES.disputeUser, user.id, now);
  const input = await body(openDisputeSchema);
  return new HttpResult(await openDispute(db, user, shipmentId, input, now), 201);
});
