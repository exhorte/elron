import { login } from "@/server/auth";
import { HttpResult, route, sessionCookie } from "@/server/http";
import { loginSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ req, db, now, body }) => {
  const input = await body(loginSchema);
  const { actor, token, expiresAt } = await login(db, input, { userAgent: req.headers.get("user-agent"), now });
  return new HttpResult({ user: actor }, 200, { "set-cookie": sessionCookie(token, expiresAt) });
});
