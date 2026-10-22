import { createOffer, listOffersByProvider } from "@/server/offers";
import { HttpResult, requireActor, route } from "@/server/http";
import { offerCreateSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async ({ db, actor }) => listOffersByProvider(db, requireActor(actor)));

export const POST = route({ auth: "user", mutation: true }, async ({ db, actor, body, now }) => {
  const offer = await createOffer(db, requireActor(actor), await body(offerCreateSchema), now);
  return new HttpResult({ id: offer.id }, 201);
});
