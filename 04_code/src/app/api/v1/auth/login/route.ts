import { RATE_POLICIES } from "@/config/rate-limits";
import { login } from "@/server/auth";
import { HttpResult, route, sessionCookie } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { loginSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ req, db, now, ip, body }) => {
  await enforceRateLimit(db, RATE_POLICIES.loginIp, ip, now);
  const input = await body(loginSchema);
  const { actor, token, expiresAt } = await login(db, input, { userAgent: req.headers.get("user-agent"), now });
  return new HttpResult({ user: actor }, 200, { "set-cookie": sessionCookie(token, expiresAt) });
});
