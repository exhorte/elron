import { z } from "zod";
import { acceptBooking } from "@/server/bookings";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, now }) => {
  const result = await acceptBooking(db, requireActor(actor), z.uuid().parse(params.id), now);
  return { bookingId: result.booking.id, shipmentId: result.shipmentId, trackingCode: result.trackingCode };
});
