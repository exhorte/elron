import { RATE_POLICIES } from "@/config/rate-limits";
import { route } from "@/server/http";
import { requestPasswordReset } from "@/server/password-reset";
import { enforceRateLimit } from "@/server/rate-limit";
import { forgotPasswordSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Réponse identique que l'adresse existe ou non. `deliveryConfigured` dit si l'envoi d'e-mails est réellement branché. */
export const POST = route({ auth: "none", mutation: true }, async ({ db, now, ip, body }) => {
  await enforceRateLimit(db, RATE_POLICIES.forgotIp, ip, now);
  const { email } = await body(forgotPasswordSchema);
  await enforceRateLimit(db, RATE_POLICIES.forgotEmail, email, now);
  return requestPasswordReset(db, email, now);
});
