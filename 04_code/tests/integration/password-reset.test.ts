import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { createSession, getActorBySessionToken, login } from "@/server/auth";
import { MemoryMailAdapter, getMailAdapter, setMailAdapterForTests } from "@/server/mail";
import { requestPasswordReset, resetPassword } from "@/server/password-reset";
import { setUserStatus } from "@/server/admin";
import { db, errorCode, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);
afterEach(() => setMailAdapterForTests(null));

const OLD = "correct-horse-battery";
const NEW = "un-tout-nouveau-mot-de-passe";
const T0 = new Date("2026-11-01T10:00:00Z");

async function setup() {
  const mail = new MemoryMailAdapter();
  const user = await makeUser({ email: "fatou@example.test", name: "Fatou" });
  return { mail, user };
}

function tokenFrom(mail: MemoryMailAdapter): string {
  const message = mail.sent.at(-1)!;
  const match = message.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  expect(match, "lien de réinitialisation dans l'e-mail").not.toBeNull();
  return match![1]!;
}

describe("demande de réinitialisation", () => {
  it("envoie un lien à l'adresse du compte ; le jeton n'est stocké que haché", async () => {
    const { mail, user } = await setup();
    const outcome = await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    expect(outcome).toEqual({ accepted: true, deliveryConfigured: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("fatou@example.test");
    const token = tokenFrom(mail);
    expect(token.length).toBeGreaterThanOrEqual(40);
    const rows = await db().select().from(schema.passwordResetTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: user.id, usedAt: null });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.expiresAt.getTime() - T0.getTime()).toBe(60 * 60_000);
  });

  it("répond de la même façon pour une adresse inconnue, sans rien envoyer ni stocker", async () => {
    const { mail } = await setup();
    const known = await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const unknown = await requestPasswordReset(db(), "inconnu@example.test", T0, mail);
    expect(unknown).toEqual(known);
    expect(mail.sent).toHaveLength(1);
    expect(await db().select().from(schema.passwordResetTokens)).toHaveLength(1);
  });

  it("n'envoie rien à un compte suspendu", async () => {
    const { mail, user } = await setup();
    const admin = await makeUser({ role: "admin" });
    await setUserStatus(db(), admin, user.id, "suspended", "test de suspension");
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    expect(mail.sent).toHaveLength(0);
  });

  it("un nouveau jeton annule les précédents", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const first = tokenFrom(mail);
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const second = tokenFrom(mail);
    expect(second).not.toBe(first);
    expect(await errorCode(resetPassword(db(), first, NEW, T0, mail))).toBe("invalid_reset_token");
    await resetPassword(db(), second, NEW, T0, mail);
  });

  it("signale honnêtement qu'aucun fournisseur d'e-mail n'est branché", async () => {
    await setup();
    const outcome = await requestPasswordReset(db(), "fatou@example.test", T0, new MemoryMailAdapter(false));
    expect(outcome.deliveryConfigured).toBe(false);
  });

  it("n'échoue pas (et ne révèle rien) si l'envoi d'e-mail plante", async () => {
    await setup();
    const broken = new MemoryMailAdapter(true, new Error("SMTP indisponible"));
    await expect(requestPasswordReset(db(), "fatou@example.test", T0, broken)).resolves.toMatchObject({ accepted: true });
  });

  it("journalise la demande sans jeton", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "password.reset_requested"));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(token);
  });
});

describe("application du nouveau mot de passe", () => {
  it("change le mot de passe, ferme toutes les sessions et lève le verrouillage", async () => {
    const { mail, user } = await setup();
    const { token: sessionToken } = await createSession(db(), user.id, null, T0);
    await db().update(schema.users).set({ failedLoginCount: 3, lockedUntil: new Date(T0.getTime() + 600_000) }).where(eq(schema.users.id, user.id));
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    await resetPassword(db(), tokenFrom(mail), NEW, T0, mail);

    expect(await getActorBySessionToken(db(), sessionToken, T0)).toBeNull();
    expect(await errorCode(login(db(), { email: "fatou@example.test", password: OLD }, { userAgent: null, now: T0 }))).toBe("invalid_credentials");
    const ok = await login(db(), { email: "fatou@example.test", password: NEW }, { userAgent: null, now: T0 });
    expect(ok.actor.id).toBe(user.id);
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("est à usage unique", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    await resetPassword(db(), token, NEW, T0, mail);
    expect(await errorCode(resetPassword(db(), token, "encore-un-autre-mot-de-passe", T0, mail))).toBe("invalid_reset_token");
    // le mot de passe n'a pas bougé
    await expect(login(db(), { email: "fatou@example.test", password: NEW }, { userAgent: null, now: T0 })).resolves.toBeDefined();
  });

  it("expire après 60 minutes", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    expect(await errorCode(resetPassword(db(), token, NEW, new Date(T0.getTime() + 61 * 60_000), mail))).toBe("invalid_reset_token");
    await expect(resetPassword(db(), token, NEW, new Date(T0.getTime() + 59 * 60_000), mail)).resolves.toBeUndefined();
  });

  it("refuse un jeton inconnu ou forgé, avec la même erreur", async () => {
    const { mail } = await setup();
    expect(await errorCode(resetPassword(db(), "a".repeat(43), NEW, T0, mail))).toBe("invalid_reset_token");
    expect(await errorCode(resetPassword(db(), "' OR 1=1 --", NEW, T0, mail))).toBe("invalid_reset_token");
  });

  it("refuse si le compte a été suspendu entre-temps", async () => {
    const { mail, user } = await setup();
    const admin = await makeUser({ role: "admin" });
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    await setUserStatus(db(), admin, user.id, "suspended", "test de suspension");
    expect(await errorCode(resetPassword(db(), token, NEW, T0, mail))).toBe("invalid_reset_token");
  });

  it("deux utilisations simultanées du même jeton : une seule réussit", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    const results = await Promise.allSettled([resetPassword(db(), token, "premier-mot-de-passe-long", T0, mail), resetPassword(db(), token, "second-mot-de-passe-long", T0, mail)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toBe("invalid_reset_token");
  });

  it("notifie le titulaire du changement et journalise sans secret", async () => {
    const { mail } = await setup();
    await requestPasswordReset(db(), "fatou@example.test", T0, mail);
    const token = tokenFrom(mail);
    await resetPassword(db(), token, NEW, T0, mail);
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]!.subject).toMatch(/modifié/);
    expect(mail.sent[1]!.text).not.toContain(NEW);
    const logs = JSON.stringify(await db().select().from(schema.auditLogs));
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(NEW);
    expect(logs).toContain("password.reset_completed");
  });
});

describe("adaptateur d'e-mail", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

  it("est « console » en développement et « disabled » en production, tous deux non opérationnels", () => {
    expect(getMailAdapter(env({ NODE_ENV: "development" }))).toMatchObject({ name: "console", operational: false });
    expect(getMailAdapter(env({ NODE_ENV: "production" }))).toMatchObject({ name: "disabled", operational: false });
  });

  it("interdit « console » en production (les liens seraient journalisés) et refuse une valeur inconnue", () => {
    expect(() => getMailAdapter(env({ NODE_ENV: "production", MAIL_TRANSPORT: "console" }))).toThrow(/interdit en production/);
    expect(() => getMailAdapter(env({ NODE_ENV: "development", MAIL_TRANSPORT: "smtp-magique" }))).toThrow(/inconnu/);
  });
});
