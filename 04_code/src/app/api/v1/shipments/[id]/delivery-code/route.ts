import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { generateShipmentDeliveryCode } from "@/server/shipments";

export const dynamic = "force-dynamic";

/** Réservé à l'expéditeur. Le code n'est renvoyé qu'ici, une seule fois, et n'est jamais relisible. */
export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, now }) => {
  const { code, expiresAt, generation } = await generateShipmentDeliveryCode(db, requireActor(actor), z.uuid().parse(params.id), now);
  return { code, expiresAt, generation, notice: "Communiquez ce code au destinataire uniquement. Il ne sera plus affiché." };
});
