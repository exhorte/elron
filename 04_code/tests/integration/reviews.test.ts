import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { REVIEW_WINDOW_DAYS } from "@/config/app";
import { schema } from "@/db/client";
import { setUserStatus } from "@/server/admin";
import { listBookings, requestBooking } from "@/server/bookings";
import { openDispute } from "@/server/disputes";
import { createReview, getReputation, getShipmentReviews, ratingsFor } from "@/server/reviews";
import { searchOffers } from "@/server/search";
import { confirmDelivery, generateShipmentDeliveryCode, transitionShipment } from "@/server/shipments";
import { searchQuerySchema } from "@/server/validation";
import { ABJ, DAY, DKR, db, dbError, errorCode, makeAcceptedShipment, makeOffer, makeRequest, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

type Ctx = Awaited<ReturnType<typeof makeAcceptedShipment>>;

async function delivered(): Promise<Ctx> {
  const ctx = await makeAcceptedShipment();
  for (const to of ["HANDED_OVER", "IN_TRANSIT", "ARRIVED"] as const) {
    await transitionShipment(db(), ctx.provider, ctx.shipmentId, { to, note: null, proofs: [] });
  }
  const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
  await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);
  return ctx;
}

describe("dépôt d'un avis", () => {
  it("permet aux deux parties de se noter après la remise, sur l'autre partie", async () => {
    const ctx = await delivered();
    await createReview(db(), ctx.sender, ctx.shipmentId, { rating: 5, comment: "  Très ponctuel, colis intact.  " });
    await createReview(db(), ctx.provider, ctx.shipmentId, { rating: 4, comment: null });
    const rows = await db().select().from(schema.reviews);
    const bySender = rows.find((r) => r.authorRole === "sender")!;
    expect(bySender).toMatchObject({ authorUserId: ctx.sender.id, subjectUserId: ctx.provider.id, rating: 5, comment: "Très ponctuel, colis intact." });
    expect(rows.find((r) => r.authorRole === "provider")).toMatchObject({ authorUserId: ctx.provider.id, subjectUserId: ctx.sender.id, rating: 4, comment: null });
  });

  it("refuse tant que la remise n'est pas confirmée, aux tiers et aux opérateurs", async () => {
    const pending = await makeAcceptedShipment();
    expect(await errorCode(createReview(db(), pending.sender, pending.shipmentId, { rating: 5 }))).toBe("review_not_available");
    const ctx = await delivered();
    expect(await errorCode(createReview(db(), await makeUser(), ctx.shipmentId, { rating: 5 }))).toBe("not_found");
    expect(await errorCode(createReview(db(), await makeUser({ role: "operator" }), ctx.shipmentId, { rating: 5 }))).toBe("only_parties_review");
  });

  it("refuse un colis annulé ou en litige", async () => {
    const cancelled = await makeAcceptedShipment();
    await transitionShipment(db(), cancelled.sender, cancelled.shipmentId, { to: "CANCELLED", note: "Plus besoin", proofs: [] });
    expect(await errorCode(createReview(db(), cancelled.sender, cancelled.shipmentId, { rating: 1 }))).toBe("review_not_available");
    const ctx = await delivered();
    await openDispute(db(), ctx.sender, ctx.shipmentId, { reasonCode: "damaged_goods", description: "Le contenu était endommagé", proofs: [] });
    expect(await errorCode(createReview(db(), ctx.sender, ctx.shipmentId, { rating: 1 }))).toBe("review_not_available");
  });

  it("n'accepte qu'un avis par auteur et par colis, même déposé deux fois en parallèle", async () => {
    const ctx = await delivered();
    const results = await Promise.allSettled([
      createReview(db(), ctx.sender, ctx.shipmentId, { rating: 5 }),
      createReview(db(), ctx.sender, ctx.shipmentId, { rating: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toBe("already_reviewed");
    expect(await db().select().from(schema.reviews)).toHaveLength(1);
  });

  it(`n'est possible que dans les ${REVIEW_WINDOW_DAYS} jours qui suivent la remise`, async () => {
    const ctx = await delivered();
    const late = new Date(Date.now() + (REVIEW_WINDOW_DAYS + 1) * DAY);
    expect(await errorCode(createReview(db(), ctx.sender, ctx.shipmentId, { rating: 5 }, late))).toBe("review_window_closed");
    const state = await getShipmentReviews(db(), ctx.sender, ctx.shipmentId, late);
    expect(state.canReview).toBe(false);
    await expect(createReview(db(), ctx.sender, ctx.shipmentId, { rating: 5 }, new Date(Date.now() + (REVIEW_WINDOW_DAYS - 1) * DAY))).resolves.toBeUndefined();
  });

  it("est immuable et borné par la base (note 1–5, pas d'auto-évaluation, commentaire ≤ 500)", async () => {
    const ctx = await delivered();
    await createReview(db(), ctx.sender, ctx.shipmentId, { rating: 4, comment: "Bien" });
    const [row] = await db().select().from(schema.reviews);
    expect(await dbError(db().update(schema.reviews).set({ rating: 5 }).where(eq(schema.reviews.id, row!.id)))).toMatch(/ajout seul/);
    expect(await dbError(db().delete(schema.reviews).where(eq(schema.reviews.id, row!.id)))).toMatch(/ajout seul/);
    const { id: _id, ...clone } = row!;
    void _id;
    expect(await dbError(db().insert(schema.reviews).values({ ...clone, authorUserId: ctx.provider.id, subjectUserId: ctx.provider.id, rating: 6 }))).toMatch(/reviews_rating_range|reviews_not_self/);
    expect(await dbError(db().insert(schema.reviews).values({ ...clone, authorUserId: ctx.provider.id, subjectUserId: ctx.provider.id }))).toMatch(/reviews_not_self/);
    expect(await dbError(db().insert(schema.reviews).values({ ...clone, authorUserId: ctx.provider.id, subjectUserId: ctx.sender.id, comment: "x".repeat(501) }))).toMatch(/reviews_comment_length/);
  });

  it("indique à chaque partie son avis, celui de l'autre et la possibilité de noter", async () => {
    const ctx = await delivered();
    expect(await getShipmentReviews(db(), ctx.sender, ctx.shipmentId)).toMatchObject({ canReview: true, mine: null, theirs: null });
    await createReview(db(), ctx.provider, ctx.shipmentId, { rating: 3, comment: "Remise un peu tardive" });
    const sender = await getShipmentReviews(db(), ctx.sender, ctx.shipmentId);
    expect(sender).toMatchObject({ canReview: true, mine: null, theirs: { rating: 3, authorRole: "provider", comment: "Remise un peu tardive" } });
    await createReview(db(), ctx.sender, ctx.shipmentId, { rating: 5 });
    const after = await getShipmentReviews(db(), ctx.sender, ctx.shipmentId);
    expect(after).toMatchObject({ canReview: false, mine: { rating: 5 }, theirs: { rating: 3 } });
    expect(await errorCode(getShipmentReviews(db(), await makeUser(), ctx.shipmentId))).toBe("not_found");
  });
});

describe("réputation", () => {
  it("agrège les notes par rôle, avec la moyenne arrondie et les livraisons", async () => {
    const a = await delivered();
    await createReview(db(), a.sender, a.shipmentId, { rating: 5 });
    await createReview(db(), a.provider, a.shipmentId, { rating: 2 });
    const rep = await getReputation(db(), a.provider.id);
    expect(rep.asProvider).toMatchObject({ delivered: 1, incidents: 0, ratings: { count: 1, average: 5, sum: 5 } });
    expect(rep.asSender.ratings.count).toBe(0);
    const repSender = await getReputation(db(), a.sender.id);
    expect(repSender.asSender).toMatchObject({ delivered: 1, ratings: { count: 1, average: 2 } });
    expect(repSender.recent).toMatchObject([{ rating: 2, authorRole: "provider" }]);

    const map = await ratingsFor(db(), [a.provider.id, a.sender.id], "provider");
    expect(map.get(a.provider.id)).toMatchObject({ count: 1, average: 5 });
    expect(map.has(a.sender.id)).toBe(false);
  });

  it("moyenne plusieurs avis sur une décimale et trie les derniers avis du plus récent au plus ancien", async () => {
    const provider = await makeUser({ traveler: true, name: "Moussa" });
    const notes = [5, 4, 4];
    for (const [i, rating] of notes.entries()) {
      const sender = await makeUser({ name: `Client ${i}` });
      const offer = await makeOffer(provider);
      const request = await makeRequest(sender);
      const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
      const { acceptBooking } = await import("@/server/bookings");
      const accepted = await acceptBooking(db(), provider, booking.id);
      for (const to of ["HANDED_OVER", "IN_TRANSIT", "ARRIVED"] as const) await transitionShipment(db(), provider, accepted.shipmentId, { to, note: null, proofs: [] });
      const { code } = await generateShipmentDeliveryCode(db(), sender, accepted.shipmentId);
      await confirmDelivery(db(), provider, accepted.shipmentId, code);
      await createReview(db(), sender, accepted.shipmentId, { rating, comment: `Avis ${i}` }, new Date(Date.now() + i * 1000));
    }
    const rep = await getReputation(db(), provider.id);
    expect(rep.asProvider.ratings).toMatchObject({ count: 3, sum: 13, average: 4.3 });
    expect(rep.recent.map((r) => r.comment)).toEqual(["Avis 2", "Avis 1", "Avis 0"]);
  });

  it("ne révèle aucune coordonnée et masque les comptes suspendus ou inconnus", async () => {
    const a = await delivered();
    await createReview(db(), a.sender, a.shipmentId, { rating: 5, comment: "Super" });
    const json = JSON.stringify(await getReputation(db(), a.provider.id));
    expect(json).not.toContain(a.provider.email);
    expect(json).not.toMatch(/phone|password|\+225/i);
    const admin = await makeUser({ role: "admin" });
    await setUserStatus(db(), admin, a.provider.id, "suspended", "test de suspension");
    expect(await errorCode(getReputation(db(), a.provider.id))).toBe("not_found");
    expect(await errorCode(getReputation(db(), "00000000-0000-4000-8000-000000000000"))).toBe("not_found");
  });
});

describe("avis et classement des offres", () => {
  it("expose la note du transporteur et valorise les bons avis dans le score de fiabilité", async () => {
    const good = await delivered();
    await createReview(db(), good.sender, good.shipmentId, { rating: 5 });
    const fresh = await makeUser({ traveler: true, name: "Nouveau" });
    await makeOffer(fresh, { pricePerKgMinor: 3500 });
    await makeOffer(good.provider, { pricePerKgMinor: 3500 });
    const res = await searchOffers(db(), null, searchQuerySchema.parse({ origin: DKR, destination: ABJ, weightKg: "5" }));
    const byName = (n: string) => res.results.find((r) => r.offer.provider.displayName === n)!;
    expect(byName("Moussa Transporteur").offer.provider.rating).toEqual({ average: 5, count: 1 });
    expect(byName("Nouveau").offer.provider.rating).toEqual({ average: null, count: 0 });
    expect(byName("Moussa Transporteur").match.breakdown.reliability.value).toBeGreaterThan(byName("Nouveau").match.breakdown.reliability.value);
    expect(res.results[0]!.offer.provider.displayName).toBe("Moussa Transporteur");
    expect(byName("Moussa Transporteur").match.flags).not.toContain("no_history");
  });

  it("montre au transporteur la note de l'expéditeur sur les demandes reçues", async () => {
    const prev = await delivered();
    await createReview(db(), prev.provider, prev.shipmentId, { rating: 4 });
    const offer = await makeOffer(prev.provider);
    const request = await makeRequest(prev.sender);
    await requestBooking(db(), prev.sender, { requestId: request.id, offerId: offer.id });
    const incoming = await listBookings(db(), prev.provider, "provider");
    expect(incoming[0]!.counterpart.rating).toEqual({ average: 4, count: 1 });
    const outgoing = await listBookings(db(), prev.sender, "sender");
    expect(outgoing[0]!.counterpart.rating).toEqual({ average: null, count: 0 });
  });
});
