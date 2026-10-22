import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { getRequestForActor, toRequestView } from "@/server/requests";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) =>
  toRequestView(await getRequestForActor(db, requireActor(actor), z.uuid().parse(params.id))),
);
