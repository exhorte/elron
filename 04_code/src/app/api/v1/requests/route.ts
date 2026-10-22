import { HttpResult, requireActor, route } from "@/server/http";
import { createRequest, listRequestsBySender } from "@/server/requests";
import { requestCreateSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async ({ db, actor }) => listRequestsBySender(db, requireActor(actor)));

export const POST = route({ auth: "user", mutation: true }, async ({ db, actor, body, now }) => {
  const row = await createRequest(db, requireActor(actor), await body(requestCreateSchema), now);
  return new HttpResult({ id: row.id }, 201);
});
