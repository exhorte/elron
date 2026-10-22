import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, SESSION_TTL_DAYS } from "@/config/app";
import { schema } from "@/db/client";
import { createSession, deleteSession, getActorBySessionToken, hashPassword, login, registerUser, verifyPassword } from "@/server/auth";
import { setUserStatus } from "@/server/admin";
import { db, errorCode, makeUser, resetDb } from "../helpers";

const PASSWORD = "correct-horse-battery";

beforeEach(resetDb);

describe("inscription", () => {
  it("crée un compte, normalise l'e-mail et ne stocke jamais le mot de passe en clair", async () => {
    const actor = await registerUser(db(), { email: "fatou@example.test", password: PASSWORD, displayName: "Fatou", asTraveler: false });
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, actor.id));
    expect(row!.email).toBe("fatou@example.test");
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain(PASSWORD);
    expect(row!.platformRole).toBe("user");
    expect(row!.isDemo).toBe(false);
  });

  it("crée le profil voyageur à la demande, sans statut d'identité vérifié", async () => {
    const actor = await registerUser(db(), { email: "t@example.test", password: PASSWORD, displayName: "Moussa", asTraveler: true });
    const [profile] = await db().select().from(schema.travelerProfiles).where(eq(schema.travelerProfiles.userId, actor.id));
    expect(profile).toBeDefined();
    expect(profile!.identityStatus).toBe("not_provided");
  });

  it("refuse un e-mail déjà utilisé (insensible à la casse)", async () => {
    await registerUser(db(), { email: "dup@example.test", password: PASSWORD, displayName: "A", asTraveler: false });
    const code = await errorCode(registerUser(db(), { email: "dup@example.test", password: PASSWORD, displayName: "B", asTraveler: false }));
    expect(code).toBe("email_taken");
  });

  it("interdit les e-mails non normalisés au niveau base de données", async () => {
    await expect(
      db().insert(schema.users).values({ email: "MAJUSCULES@example.test", passwordHash: "x", displayName: "x" }),
    ).rejects.toThrow();
  });
});

describe("mots de passe", () => {
  it("vérifie le bon mot de passe et rejette les autres, hashs salés", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword("mauvais-mot-de-passe", a)).toBe(false);
    expect(await verifyPassword(PASSWORD, "pas-un-hash")).toBe(false);
  });
});

describe("connexion et sessions", () => {
  it("connecte avec les bons identifiants et crée une session valide", async () => {
    const user = await makeUser({ email: "ok@example.test" });
    const { token, actor } = await login(db(), { email: "ok@example.test", password: PASSWORD }, { userAgent: "vitest" });
    expect(actor.id).toBe(user.id);
    const resolved = await getActorBySessionToken(db(), token, new Date());
    expect(resolved?.id).toBe(user.id);
  });

  it("ne stocke que l'empreinte du jeton de session", async () => {
    await makeUser({ email: "h@example.test" });
    const { token } = await login(db(), { email: "h@example.test", password: PASSWORD }, { userAgent: null });
    const rows = await db().select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuse un mauvais mot de passe et un e-mail inconnu avec la même erreur", async () => {
    await makeUser({ email: "known@example.test" });
    expect(await errorCode(login(db(), { email: "known@example.test", password: "faux-faux-faux" }, { userAgent: null }))).toBe("invalid_credentials");
    expect(await errorCode(login(db(), { email: "inconnu@example.test", password: "faux-faux-faux" }, { userAgent: null }))).toBe("invalid_credentials");
  });

  it("verrouille le compte après trop d'échecs, même avec le bon mot de passe, puis le déverrouille", async () => {
    await makeUser({ email: "lock@example.test" });
    const t0 = new Date();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      expect(await errorCode(login(db(), { email: "lock@example.test", password: "faux-faux-faux" }, { userAgent: null, now: t0 }))).toBe("invalid_credentials");
    }
    expect(await errorCode(login(db(), { email: "lock@example.test", password: PASSWORD }, { userAgent: null, now: t0 }))).toBe("account_locked");
    const later = new Date(t0.getTime() + (LOGIN_LOCK_MINUTES + 1) * 60_000);
    const ok = await login(db(), { email: "lock@example.test", password: PASSWORD }, { userAgent: null, now: later });
    expect(ok.token.length).toBeGreaterThan(20);
    const [row] = await db().select().from(schema.users).where(eq(schema.users.email, "lock@example.test"));
    expect(row!.failedLoginCount).toBe(0);
    expect(row!.lockedUntil).toBeNull();
  });

  it("un succès remet le compteur d'échecs à zéro", async () => {
    await makeUser({ email: "reset@example.test" });
    await errorCode(login(db(), { email: "reset@example.test", password: "faux-faux-faux" }, { userAgent: null }));
    await login(db(), { email: "reset@example.test", password: PASSWORD }, { userAgent: null });
    const [row] = await db().select().from(schema.users).where(eq(schema.users.email, "reset@example.test"));
    expect(row!.failedLoginCount).toBe(0);
  });

  it("expire les sessions", async () => {
    const user = await makeUser();
    const t0 = new Date();
    const { token } = await createSession(db(), user.id, null, t0);
    expect(await getActorBySessionToken(db(), token, new Date(t0.getTime() + (SESSION_TTL_DAYS - 1) * 86_400_000))).not.toBeNull();
    expect(await getActorBySessionToken(db(), token, new Date(t0.getTime() + (SESSION_TTL_DAYS + 1) * 86_400_000))).toBeNull();
  });

  it("invalide la session à la déconnexion et ignore les jetons forgés", async () => {
    const user = await makeUser();
    const { token } = await createSession(db(), user.id, null, new Date());
    await deleteSession(db(), token);
    expect(await getActorBySessionToken(db(), token, new Date())).toBeNull();
    expect(await getActorBySessionToken(db(), "jeton-forge-qui-nexiste-pas-du-tout", new Date())).toBeNull();
    expect(await getActorBySessionToken(db(), undefined, new Date())).toBeNull();
  });

  it("un compte suspendu ne peut ni se connecter ni utiliser une session existante", async () => {
    const admin = await makeUser({ role: "admin" });
    const user = await makeUser({ email: "susp@example.test" });
    const { token } = await login(db(), { email: "susp@example.test", password: PASSWORD }, { userAgent: null });
    await setUserStatus(db(), admin, user.id, "suspended", "test de suspension");
    expect(await getActorBySessionToken(db(), token, new Date())).toBeNull();
    expect(await errorCode(login(db(), { email: "susp@example.test", password: PASSWORD }, { userAgent: null }))).toBe("account_suspended");
  });
});
