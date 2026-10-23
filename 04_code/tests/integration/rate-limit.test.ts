import { beforeEach, describe, expect, it } from "vitest";
import { RATE_POLICIES, type RatePolicy } from "@/config/rate-limits";
import { schema } from "@/db/client";
import { consumeRateLimit, enforceRateLimit, purgeRateLimitBuckets } from "@/server/rate-limit";
import { db, resetDb } from "../helpers";

beforeEach(resetDb);

const POLICY: RatePolicy = { name: "test_policy", limit: 3, windowSeconds: 600 };
const T0 = new Date("2026-11-01T10:00:00Z");

describe("limitation de débit en base", () => {
  it("autorise jusqu'à la limite puis refuse, avec un compte restant décroissant", async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await consumeRateLimit(db(), POLICY, "203.0.113.9", T0));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(results[4]!.count).toBe(5);
  });

  it("isole les sujets et les politiques", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit(db(), POLICY, "a", T0);
    expect((await consumeRateLimit(db(), POLICY, "a", T0)).allowed).toBe(false);
    expect((await consumeRateLimit(db(), POLICY, "b", T0)).allowed).toBe(true);
    expect((await consumeRateLimit(db(), { ...POLICY, name: "autre" }, "a", T0)).allowed).toBe(true);
  });

  it("repart de zéro à la fenêtre suivante et indique le délai d'attente", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit(db(), POLICY, "a", T0);
    const blocked = await consumeRateLimit(db(), POLICY, "a", new Date(T0.getTime() + 60_000));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(POLICY.windowSeconds);
    // T0 est un début de fenêtre de 10 min : +600 s ouvre la fenêtre suivante
    const next = await consumeRateLimit(db(), POLICY, "a", new Date(T0.getTime() + POLICY.windowSeconds * 1000));
    expect(next).toMatchObject({ allowed: true, count: 1 });
  });

  it("ne stocke ni IP ni e-mail en clair", async () => {
    await consumeRateLimit(db(), RATE_POLICIES.forgotEmail, "fatou@example.test", T0);
    await consumeRateLimit(db(), RATE_POLICIES.loginIp, "203.0.113.9", T0);
    const rows = JSON.stringify(await db().select().from(schema.rateLimitBuckets));
    expect(rows).not.toContain("fatou");
    expect(rows).not.toContain("203.0.113.9");
    expect(rows).toContain("forgot_email:");
  });

  it("compte exactement sous requêtes parallèles (incrément atomique)", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeRateLimit(db(), { ...POLICY, limit: 10 }, "burst", T0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(Math.max(...results.map((r) => r.count))).toBe(30);
  });

  it("enforceRateLimit lève une 429 avec l'en-tête Retry-After", async () => {
    for (let i = 0; i < 3; i += 1) await enforceRateLimit(db(), POLICY, "x", T0);
    try {
      await enforceRateLimit(db(), POLICY, "x", T0);
      expect.unreachable();
    } catch (err) {
      const e = err as { status: number; code: string; headers: Record<string, string>; details: { retryAfterSeconds: number } };
      expect(e.status).toBe(429);
      expect(e.code).toBe("rate_limited");
      expect(Number(e.headers["retry-after"])).toBe(e.details.retryAfterSeconds);
    }
  });

  it("purge uniquement les fenêtres périmées", async () => {
    await consumeRateLimit(db(), POLICY, "vieux", new Date(T0.getTime() - 3 * 24 * 3600 * 1000));
    await consumeRateLimit(db(), POLICY, "recent", T0);
    await purgeRateLimitBuckets(db(), T0);
    const rows = await db().select().from(schema.rateLimitBuckets);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.windowStart.getTime()).toBe(T0.getTime());
  });

  it("définit des politiques cohérentes (limites positives, fenêtres bornées à 2 jours)", () => {
    for (const p of Object.values(RATE_POLICIES)) {
      expect(p.limit).toBeGreaterThan(0);
      expect(p.windowSeconds).toBeGreaterThan(0);
      expect(p.windowSeconds).toBeLessThanOrEqual(2 * 24 * 3600);
    }
    expect(new Set(Object.values(RATE_POLICIES).map((p) => p.name)).size).toBe(Object.keys(RATE_POLICIES).length);
  });
});
