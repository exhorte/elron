import { z } from "zod";
import { getBookingForParty } from "@/server/bookings";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) =>
  getBookingForParty(db, requireActor(actor), z.uuid().parse(params.id)),
);
