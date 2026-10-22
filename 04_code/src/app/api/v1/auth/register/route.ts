import { createSession, registerUser } from "@/server/auth";
import { HttpResult, route, sessionCookie } from "@/server/http";
import { registerSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ req, db, now, body }) => {
  const input = await body(registerSchema);
  const actor = await registerUser(db, input);
  const session = await createSession(db, actor.id, req.headers.get("user-agent"), now);
  return new HttpResult({ user: actor }, 201, { "set-cookie": sessionCookie(session.token, session.expiresAt) });
});
