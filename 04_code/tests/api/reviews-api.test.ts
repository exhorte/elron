import { beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { GET as reviewsGet, POST as reviewsPost } from "@/app/api/v1/shipments/[id]/reviews/route";
import { GET as reputationGet } from "@/app/api/v1/users/[id]/reputation/route";
import { RATE_POLICIES } from "@/config/rate-limits";
import { confirmDelivery, generateShipmentDeliveryCode, transitionShipment } from "@/server/shipments";
import { db, makeAcceptedShipment, makeUser, resetDb } from "../helpers";
import { call, cookieFrom } from "./http-helpers";

beforeEach(resetDb);

const cookieFor = async (email: string) =>
  cookieFrom(await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email, password: "correct-horse-battery" } }));

async function deliveredShipment() {
  const ctx = await makeAcceptedShipment();
  for (const to of ["HANDED_OVER", "IN_TRANSIT", "ARRIVED"] as const) await transitionShipment(db(), ctx.provider, ctx.shipmentId, { to, note: null, proofs: [] });
  const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
  await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);
  return { ctx, sender: await cookieFor(ctx.sender.email), provider: await cookieFor(ctx.provider.email) };
}

const post = (id: string, cookie: string | undefined, body: unknown) =>
  call(reviewsPost, { method: "POST", path: `/api/v1/shipments/${id}/reviews`, cookie, params: { id }, body });

describe("API : avis et réputation", () => {
  it("dépose un avis (201), le restitue aux deux parties, et alimente la réputation publique sans authentification", async () => {
    const { ctx, sender, provider } = await deliveredShipment();
    const res = await post(ctx.shipmentId, sender, { rating: 5, comment: "Parfait" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ canReview: false, mine: { rating: 5, comment: "Parfait" }, theirs: null });

    const seenByProvider = await call(reviewsGet, { path: `/api/v1/shipments/${ctx.shipmentId}/reviews`, cookie: provider, params: { id: ctx.shipmentId } });
    expect(seenByProvider.json.data).toMatchObject({ canReview: true, mine: null, theirs: { rating: 5, comment: "Parfait" } });

    const rep = await call(reputationGet, { path: `/api/v1/users/${ctx.provider.id}/reputation`, params: { id: ctx.provider.id } });
    expect(rep.status).toBe(200);
    expect(rep.json.data.asProvider).toMatchObject({ delivered: 1, incidents: 0, ratings: { count: 1, average: 5 } });
    expect(rep.json.data.recent[0]).toMatchObject({ rating: 5, comment: "Parfait", authorRole: "sender" });
    expect(rep.text).not.toContain(ctx.provider.email);
    expect(rep.text).not.toContain(ctx.sender.email);
  });

  it("refuse un second avis (409), une note hors 1–5 ou non entière, des champs inconnus et les non-connectés", async () => {
    const { ctx, sender } = await deliveredShipment();
    expect((await post(ctx.shipmentId, undefined, { rating: 5 })).status).toBe(401);
    for (const rating of [0, 6, 2.5, "5", null]) expect((await post(ctx.shipmentId, sender, { rating })).status, String(rating)).toBe(422);
    expect((await post(ctx.shipmentId, sender, { rating: 4, subjectUserId: ctx.provider.id })).status).toBe(422);
    expect((await post(ctx.shipmentId, sender, { rating: 4, comment: "x".repeat(501) })).status).toBe(422);
    expect((await post(ctx.shipmentId, sender, { rating: 4 })).status).toBe(201);
    const again = await post(ctx.shipmentId, sender, { rating: 1 });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("already_reviewed");
  });

  it("masque le colis aux tiers (404) et refuse un colis non livré (409)", async () => {
    const { ctx } = await deliveredShipment();
    const stranger = await cookieFor((await makeUser({ email: "tiers-avis@example.test" })).email);
    expect((await post(ctx.shipmentId, stranger, { rating: 5 })).status).toBe(404);
    expect((await call(reviewsGet, { path: `/api/v1/shipments/${ctx.shipmentId}/reviews`, cookie: stranger, params: { id: ctx.shipmentId } })).status).toBe(404);

    const pending = await makeAcceptedShipment();
    const res = await post(pending.shipmentId, await cookieFor(pending.sender.email), { rating: 5 });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("review_not_available");
  });

  it("répond 404 pour une réputation inconnue ou invalide et limite les dépôts par utilisateur (429)", async () => {
    const { ctx, sender } = await deliveredShipment();
    expect((await call(reputationGet, { path: "/api/v1/users/x/reputation", params: { id: "x" } })).status).toBe(422);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await call(reputationGet, { path: `/api/v1/users/${unknown}/reputation`, params: { id: unknown } })).status).toBe(404);
    for (let i = 0; i < RATE_POLICIES.reviewUser.limit; i += 1) expect((await post(ctx.shipmentId, sender, { rating: 9 })).status).toBe(422);
    expect((await post(ctx.shipmentId, sender, { rating: 5 })).status).toBe(429);
  });
});
