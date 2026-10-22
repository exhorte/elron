import { z } from "zod";
import { listBookings, requestBooking } from "@/server/bookings";
import { HttpResult, requireActor, route } from "@/server/http";
import { bookingCreateSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

const listQuery = z.object({ as: z.enum(["sender", "provider"]).default("sender") });

export const GET = route({ auth: "user" }, async ({ db, actor, query }) => {
  const { as } = query(listQuery);
  return listBookings(db, requireActor(actor), as);
});

export const POST = route({ auth: "user", mutation: true }, async ({ db, actor, body, now }) => {
  const booking = await requestBooking(db, requireActor(actor), await body(bookingCreateSchema), now);
  return new HttpResult({ id: booking.id, status: booking.status, subtotalMinor: booking.subtotalMinor, currency: booking.currency }, 201);
});
