import { deleteSession } from "@/server/auth";
import { HttpResult, clearSessionCookie, route, sessionTokenFrom } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ req, db }) => {
  await deleteSession(db, sessionTokenFrom(req));
  return new HttpResult({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
});
