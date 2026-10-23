import { z } from "zod";
import { RATE_POLICIES } from "@/config/rate-limits";
import { HttpResult, requireActor, route } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { createReview, getShipmentReviews } from "@/server/reviews";
import { reviewSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Avis du colis vus par une partie : le sien, celui de l'autre, et si le dépôt est encore possible. */
export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params, now }) =>
  getShipmentReviews(db, requireActor(actor), z.uuid().parse(params.id), now),
);

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const user = requireActor(actor);
  const shipmentId = z.uuid().parse(params.id);
  await enforceRateLimit(db, RATE_POLICIES.reviewUser, user.id, now);
  await createReview(db, user, shipmentId, await body(reviewSchema), now);
  return new HttpResult(await getShipmentReviews(db, user, shipmentId, now), 201);
});
