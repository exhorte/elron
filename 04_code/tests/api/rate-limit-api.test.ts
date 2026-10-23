import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as registerRoute } from "@/app/api/v1/auth/register/route";
import { POST as confirmRoute } from "@/app/api/v1/shipments/[id]/confirm-delivery/route";
import { RATE_POLICIES } from "@/config/rate-limits";
import { makeUser, resetDb } from "../helpers";
import { call, cookieFrom } from "./http-helpers";

beforeEach(resetDb);
afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

const register = (n: number, headers?: Record<string, string>) =>
  call(registerRoute, {
    method: "POST",
    path: "/api/v1/auth/register",
    headers,
    body: { email: `rl${n}-${Math.random().toString(36).slice(2)}@example.test`, password: "correct-horse-battery", displayName: `Utilisateur ${n}` },
  });

describe("limitation de débit sur les endpoints sensibles", () => {
  it("bloque les inscriptions massives d'une même origine (429 + Retry-After)", async () => {
    for (let i = 0; i < RATE_POLICIES.registerIp.limit; i += 1) expect((await register(i)).status).toBe(201);
    const blocked = await register(99);
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.json.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limite la connexion par IP, même avec des identifiants valides", async () => {
    const user = await makeUser({ email: "rl-login@example.test" });
    const attempt = () =>
      call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: user.email, password: "correct-horse-battery" } });
    for (let i = 0; i < RATE_POLICIES.loginIp.limit; i += 1) expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(429);
  });

  it("sépare les compteurs par IP derrière un proxy de confiance, et ignore une IP forgée à gauche", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const limit = RATE_POLICIES.registerIp.limit;
    // l'attaquant tourne « 1.1.1.x » à gauche ; le proxy de confiance ajoute toujours la vraie IP 203.0.113.9 à droite
    for (let i = 0; i < limit; i += 1) expect((await register(i, { "x-forwarded-for": `1.1.1.${i}, 203.0.113.9` })).status).toBe(201);
    expect((await register(50, { "x-forwarded-for": "1.1.1.200, 203.0.113.9" })).status).toBe(429);
    // un autre client réel n'est pas affecté
    expect((await register(51, { "x-forwarded-for": "198.51.100.7" })).status).toBe(201);
  });

  it("sans proxy de confiance, X-Forwarded-For ne permet pas d'échapper à la limite", async () => {
    const limit = RATE_POLICIES.registerIp.limit;
    for (let i = 0; i < limit; i += 1) expect((await register(i, { "x-forwarded-for": `9.9.9.${i}` })).status).toBe(201);
    expect((await register(60, { "x-forwarded-for": "8.8.8.8" })).status).toBe(429);
  });

  it("plafonne les confirmations de remise par utilisateur, tous colis confondus", async () => {
    const user = await makeUser({ email: "rl-confirm@example.test" });
    const login = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: user.email, password: "correct-horse-battery" } });
    const cookie = cookieFrom(login);
    const id = "6f1c2f0e-3d62-4b8e-9d0a-0a2c8b1d5e11";
    const attempt = () => call(confirmRoute, { method: "POST", path: `/api/v1/shipments/${id}/confirm-delivery`, cookie, params: { id }, body: { code: "123456" } });
    for (let i = 0; i < RATE_POLICIES.confirmDeliveryUser.limit; i += 1) expect((await attempt()).status).toBe(404);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});
