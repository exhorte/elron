import { z } from "zod";
import { rejectBooking } from "@/server/bookings";
import { requireActor, route } from "@/server/http";
import { reasonSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, body, now }) => {
  const { reason } = await body(reasonSchema);
  await rejectBooking(db, requireActor(actor), z.uuid().parse(params.id), reason, now);
  return { ok: true };
});
