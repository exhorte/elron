import { z } from "zod";
import { cancelOffer } from "@/server/offers";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, now }) => {
  await cancelOffer(db, requireActor(actor), z.uuid().parse(params.id), now);
  return { ok: true };
});
