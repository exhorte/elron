import { z } from "zod";
import { requireActor, route } from "@/server/http";
import { matchesForRequest } from "@/server/search";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params, req, now }) => {
  const explain = new URL(req.url).searchParams.get("explain") === "1";
  return matchesForRequest(db, requireActor(actor), z.uuid().parse(params.id), now, explain);
});
