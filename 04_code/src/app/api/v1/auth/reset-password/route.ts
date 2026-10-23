import { RATE_POLICIES } from "@/config/rate-limits";
import { route } from "@/server/http";
import { resetPassword } from "@/server/password-reset";
import { enforceRateLimit } from "@/server/rate-limit";
import { resetPasswordSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "none", mutation: true }, async ({ db, now, ip, body }) => {
  await enforceRateLimit(db, RATE_POLICIES.resetIp, ip, now);
  const { token, password } = await body(resetPasswordSchema);
  await resetPassword(db, token, password, now);
  return { ok: true };
});
