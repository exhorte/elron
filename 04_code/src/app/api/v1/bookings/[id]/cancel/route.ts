import { z } from "zod";
import { cancelPendingBooking } from "@/server/bookings";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, now }) => {
  await cancelPendingBooking(db, requireActor(actor), z.uuid().parse(params.id), now);
  return { ok: true };
});
