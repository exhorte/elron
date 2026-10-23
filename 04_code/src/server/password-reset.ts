import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { PASSWORD_RESET_TTL_MINUTES, getAppBaseUrl } from "@/config/app";
import { schema, type Db } from "@/db/client";
import { audit } from "./audit";
import { hashPassword, hashToken } from "./auth";
import { invalid } from "./errors";
import { getMailAdapter, type MailAdapter } from "./mail";

const { users, passwordResetTokens, sessions } = schema;

export interface ResetRequestOutcome {
  /** Toujours « accepté » : la réponse ne doit pas révéler si l'adresse existe. */
  accepted: true;
  /** `false` tant qu'aucun fournisseur d'e-mail réel n'est branché : l'interface le dit à l'utilisateur. */
  deliveryConfigured: boolean;
}

/**
 * Demande de réinitialisation. Même réponse que l'adresse existe ou non (anti-énumération) ; la seule
 * différence observable est le travail interne (le message est envoyé sans attendre pour limiter l'écart
 * de temps de réponse). Un nouveau jeton annule les précédents.
 */
export async function requestPasswordReset(
  db: Db,
  email: string,
  now = new Date(),
  mail: MailAdapter = getMailAdapter(),
): Promise<ResetRequestOutcome> {
  const outcome: ResetRequestOutcome = { accepted: true, deliveryConfigured: mail.operational };
  const [user] = await db.select().from(users).where(and(eq(users.email, email), eq(users.status, "active"))).limit(1);
  if (!user) return outcome;

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000),
    });
    await audit(tx, { actorUserId: null, action: "password.reset_requested", entityType: "user", entityId: user.id });
  });

  const link = `${getAppBaseUrl()}/reset-password?token=${token}`;
  void mail
    .send({
      to: user.email,
      subject: "ALX — réinitialisation de votre mot de passe",
      text:
        `Bonjour ${user.displayName},\n\n` +
        `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable ${PASSWORD_RESET_TTL_MINUTES} minutes, usage unique) :\n${link}\n\n` +
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    })
    .catch((err: unknown) => console.error("[mail] échec d'envoi de la réinitialisation", (err as Error).message));
  return outcome;
}

/**
 * Applique un nouveau mot de passe. Le jeton est à usage unique (verrou de ligne : deux utilisations
 * simultanées ne peuvent pas réussir toutes les deux) ; toutes les sessions du compte sont révoquées et le
 * verrouillage de connexion est levé. Erreur identique pour jeton inconnu, expiré, déjà utilisé ou compte suspendu.
 */
export async function resetPassword(
  db: Db,
  token: string,
  newPassword: string,
  now = new Date(),
  mail: MailAdapter = getMailAdapter(),
): Promise<void> {
  const passwordHash = await hashPassword(newPassword); // calcul coûteux hors transaction
  const failure = () => invalid("invalid_reset_token", "Lien invalide ou expiré : refaites une demande de réinitialisation");

  const notify = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hashToken(token))).for("update");
    if (!row || row.usedAt || row.expiresAt <= now) throw failure();
    const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).for("update");
    if (!user || user.status !== "active") throw failure();

    await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, row.id));
    await tx.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await audit(tx, { actorUserId: user.id, action: "password.reset_completed", entityType: "user", entityId: user.id });
    return { to: user.email, name: user.displayName };
  });

  void mail
    .send({
      to: notify.to,
      subject: "ALX — votre mot de passe a été modifié",
      text: `Bonjour ${notify.name},\n\nLe mot de passe de votre compte vient d'être modifié et toutes les sessions ont été fermées.\nSi vous n'êtes pas à l'origine de ce changement, demandez immédiatement une nouvelle réinitialisation et contactez le support.`,
    })
    .catch((err: unknown) => console.error("[mail] échec d'envoi de l'avis de changement", (err as Error).message));
}
