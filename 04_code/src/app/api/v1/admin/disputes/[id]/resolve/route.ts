import { z } from "zod";
import { resolveDispute } from "@/server/disputes";
import { requireActor, route } from "@/server/http";
import { resolveDisputeSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "operator", mutation: true }, async ({ db, actor, params, body, now }) => {
  const input = await body(resolveDisputeSchema);
  return resolveDispute(db, requireActor(actor), z.uuid().parse(params.id), input, now);
});
