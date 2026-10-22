import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { cancelRequest } from "@/server/requests";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, now }) => {
  await cancelRequest(db, requireActor(actor), z.uuid().parse(params.id), now);
  return { ok: true };
});
