import { z } from "zod";
import { setUserStatus } from "@/server/admin";
import { requireActor, route } from "@/server/http";
import { userStatusSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "admin", mutation: true }, async ({ db, actor, params, body }) => {
  const { status, reason } = await body(userStatusSchema);
  await setUserStatus(db, requireActor(actor), z.uuid().parse(params.id), status, reason);
  return { ok: true };
});
