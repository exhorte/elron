import { z } from "zod";
import { RATE_POLICIES } from "@/config/rate-limits";
import { postDisputeMessage } from "@/server/disputes";
import { HttpResult, requireActor, route } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { disputeMessageSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const disputeId = z.uuid().parse(params.id);
  await enforceRateLimit(db, RATE_POLICIES.disputeMessageUser, user.id, now);
  const input = await body(disputeMessageSchema);
  return new HttpResult(await postDisputeMessage(db, user, disputeId, input, now), 201);
});
