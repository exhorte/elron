import { RATE_POLICIES } from "@/config/rate-limits";
import { createSession, registerUser } from "@/server/auth";
import { HttpResult, route, sessionCookie } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { registerSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ req, db, now, ip, body }) => {
  await enforceRateLimit(db, RATE_POLICIES.registerIp, ip, now);
  const input = await body(registerSchema);
  const actor = await registerUser(db, input);
  const session = await createSession(db, actor.id, req.headers.get("user-agent"), now);
  return new HttpResult({ user: actor }, 201, { "set-cookie": sessionCookie(session.token, session.expiresAt) });
});
