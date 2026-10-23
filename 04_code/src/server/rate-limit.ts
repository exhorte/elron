import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { RatePolicy } from "@/config/rate-limits";
import { schema, type Db } from "@/db/client";
import { rateLimited } from "./errors";

const { rateLimitBuckets } = schema;

export interface RateDecision {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** Les sujets (IP, e-mail, utilisateur) ne sont jamais stockés en clair : empreinte SHA-256 tronquée. */
function bucketKey(policy: RatePolicy, subject: string): string {
  return `${policy.name}:${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;
}

/**
 * Incrémente atomiquement le compteur de la fenêtre courante (INSERT … ON CONFLICT DO UPDATE) et dit si
 * la requête est autorisée. À appeler avec `db`, jamais dans une transaction qui peut échouer : un rollback
 * effacerait la tentative comptée. Fenêtre fixe : une rafale à cheval sur deux fenêtres peut atteindre
 * 2 × la limite (compromis assumé, simple et sans état en mémoire).
 */
export async function consumeRateLimit(db: Db, policy: RatePolicy, subject: string, now = new Date()): Promise<RateDecision> {
  const windowMs = policy.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key: bucketKey(policy, subject), windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });
  const count = row!.count;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  return { allowed: count <= policy.limit, count, remaining: Math.max(0, policy.limit - count), retryAfterSeconds };
}

/** Lève une 429 (avec `Retry-After`) si la limite est dépassée. */
export async function enforceRateLimit(db: Db, policy: RatePolicy, subject: string, now = new Date()): Promise<void> {
  const decision = await consumeRateLimit(db, policy, subject, now);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  // Entretien opportuniste : environ une requête sur 200 purge les fenêtres périmées.
  if (Math.random() < 0.005) await purgeRateLimitBuckets(db, now);
}

/** Supprime les fenêtres de plus de 2 jours (aucune politique n'a de fenêtre plus longue). */
export async function purgeRateLimitBuckets(db: Db, now = new Date()): Promise<void> {
  await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, new Date(now.getTime() - 2 * 24 * 3600 * 1000)));
}
