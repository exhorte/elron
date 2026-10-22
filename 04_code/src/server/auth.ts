import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, SESSION_TTL_DAYS } from "@/config/app";
import { isUniqueViolation } from "@/db/errors";
import type { Db } from "@/db/client";
import { schema } from "@/db/client";
import type { Actor } from "./actor";
import { AppError, conflict, forbidden, tooManyRequests } from "./errors";
import type { LoginInput, RegisterInput } from "./validation";

const { users, sessions, travelerProfiles } = schema;

// ── Mots de passe : scrypt (Node natif, aucune dépendance). Paramètres encodés dans le hash stocké.

function scryptAsync(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function scryptCost(): number {
  const n = Number(process.env.SCRYPT_N ?? 32768);
  return Number.isInteger(n) && n >= 1024 && (n & (n - 1)) === 0 ? n : 32768;
}

export async function hashPassword(password: string): Promise<string> {
  const N = scryptCost();
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, N, 8, 1);
  return `scrypt$${N}$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scryptAsync(password, salt, expected.length, Number(nStr), Number(rStr), Number(pStr));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;
/** Hash factice : égalise le temps de réponse quand l'e-mail n'existe pas (anti-énumération). */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
}

// ── Sessions : jeton aléatoire côté client, empreinte SHA-256 en base.

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toActor(row: typeof users.$inferSelect): Actor {
  return { id: row.id, email: row.email, displayName: row.displayName, platformRole: row.platformRole, isDemo: row.isDemo };
}

export async function createSession(db: Db, userId: string, userAgent: string | null, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function getActorBySessionToken(db: Db, token: string | undefined, now: Date): Promise<Actor | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), eq(users.status, "active")))
    .limit(1);
  return rows[0] ? toActor(rows[0].user) : null;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

// ── Inscription / connexion

export async function registerUser(db: Db, input: RegisterInput): Promise<Actor> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, displayName: input.displayName, phone: input.phone ?? null })
        .returning();
      if (input.asTraveler) await tx.insert(travelerProfiles).values({ userId: user!.id });
      return toActor(user!);
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_key")) throw conflict("email_taken", "Cette adresse e-mail est déjà utilisée");
    throw err;
  }
}

export async function login(
  db: Db,
  input: LoginInput,
  context: { userAgent: string | null; now?: Date },
): Promise<{ actor: Actor; token: string; expiresAt: Date }> {
  const now = context.now ?? new Date();
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (user?.lockedUntil && user.lockedUntil > now) {
    throw tooManyRequests("account_locked", "Trop de tentatives. Réessayez plus tard.");
  }

  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) {
    if (user) {
      const failures = (user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginCount) + 1;
      const shouldLock = failures >= LOGIN_MAX_FAILURES;
      await db
        .update(users)
        .set({
          failedLoginCount: shouldLock ? 0 : failures,
          lockedUntil: shouldLock ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000) : null,
        })
        .where(eq(users.id, user.id));
    }
    throw new AppError(401, "invalid_credentials", "Identifiants invalides");
  }
  if (user.status !== "active") throw forbidden("account_suspended", "Compte suspendu");

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  const session = await createSession(db, user.id, context.userAgent, now);
  return { actor: toActor(user), ...session };
}
