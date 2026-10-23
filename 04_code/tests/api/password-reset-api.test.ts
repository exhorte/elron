import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as forgotRoute } from "@/app/api/v1/auth/forgot-password/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as resetRoute } from "@/app/api/v1/auth/reset-password/route";
import { RATE_POLICIES } from "@/config/rate-limits";
import { MemoryMailAdapter, setMailAdapterForTests } from "@/server/mail";
import { makeUser, resetDb } from "../helpers";
import { call } from "./http-helpers";

let mail: MemoryMailAdapter;
beforeEach(async () => {
  await resetDb();
  mail = new MemoryMailAdapter(true);
  setMailAdapterForTests(mail);
});
afterEach(() => setMailAdapterForTests(null));

const forgot = (email: string) => call(forgotRoute, { method: "POST", path: "/api/v1/auth/forgot-password", body: { email } });
const reset = (token: string, password: string) => call(resetRoute, { method: "POST", path: "/api/v1/auth/reset-password", body: { token, password } });

describe("API : mot de passe oublié", () => {
  it("renvoie exactement la même réponse pour une adresse connue et inconnue", async () => {
    await makeUser({ email: "connu@example.test" });
    const a = await forgot("connu@example.test");
    const b = await forgot("inconnu@example.test");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json).toEqual(b.json);
    expect(a.json.data).toEqual({ accepted: true, deliveryConfigured: true });
    expect(mail.sent).toHaveLength(1);
  });

  it("parcours complet : demande → lien → nouveau mot de passe → connexion", async () => {
    await makeUser({ email: "parcours@example.test" });
    await forgot("parcours@example.test");
    const token = mail.sent[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;

    const done = await reset(token, "mot-de-passe-tout-neuf");
    expect(done.status).toBe(200);
    expect((await reset(token, "mot-de-passe-tout-neuf-2")).json.error.code).toBe("invalid_reset_token");

    const bad = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: "parcours@example.test", password: "correct-horse-battery" } });
    expect(bad.status).toBe(401);
    const good = await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email: "parcours@example.test", password: "mot-de-passe-tout-neuf" } });
    expect(good.status).toBe(200);
  });

  it("valide les entrées : mot de passe court, jeton mal formé, champs inconnus", async () => {
    expect((await reset("a".repeat(43), "court")).status).toBe(422);
    expect((await reset("pas valide!", "mot-de-passe-assez-long")).status).toBe(422);
    expect((await forgot("pas-un-email")).status).toBe(422);
    const extra = await call(forgotRoute, { method: "POST", path: "/api/v1/auth/forgot-password", body: { email: "a@example.test", role: "admin" } });
    expect(extra.status).toBe(422);
    expect((await reset("a".repeat(43), "mot-de-passe-assez-long")).json.error.code).toBe("invalid_reset_token");
  });

  it("limite les demandes par adresse (3/h) et par IP (5/h)", async () => {
    await makeUser({ email: "cible@example.test" });
    for (let i = 0; i < RATE_POLICIES.forgotEmail.limit; i += 1) expect((await forgot("cible@example.test")).status).toBe(200);
    const blocked = await forgot("cible@example.test");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
    expect(mail.sent).toHaveLength(RATE_POLICIES.forgotEmail.limit);

    // d'autres adresses passent jusqu'au plafond par IP (déjà 4 appels comptés)
    for (let i = 0; i < RATE_POLICIES.forgotIp.limit - 4; i += 1) expect((await forgot(`autre${i}@example.test`)).status).toBe(200);
    expect((await forgot("encore@example.test")).status).toBe(429);
  });

  it("la limitation s'applique aussi aux adresses inconnues (pas d'oracle)", async () => {
    for (let i = 0; i < RATE_POLICIES.forgotEmail.limit; i += 1) await forgot("fantome@example.test");
    expect((await forgot("fantome@example.test")).status).toBe(429);
  });

  it("limite les tentatives de jeton par IP", async () => {
    for (let i = 0; i < RATE_POLICIES.resetIp.limit; i += 1) expect((await reset("b".repeat(43), "mot-de-passe-assez-long")).status).toBe(422);
    expect((await reset("b".repeat(43), "mot-de-passe-assez-long")).status).toBe(429);
  });
});
