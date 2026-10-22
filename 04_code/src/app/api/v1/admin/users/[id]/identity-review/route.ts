import { z } from "zod";
import { reviewIdentity } from "@/server/admin";
import { requireActor, route } from "@/server/http";
import { identityReviewSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "operator", mutation: true }, async ({ db, actor, params, body, now }) => {
  const { decision, note } = await body(identityReviewSchema);
  await reviewIdentity(db, requireActor(actor), z.uuid().parse(params.id), decision, note, now);
  return { ok: true };
});
