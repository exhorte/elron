import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { cancelOffer, getOfferView, listOffersByProvider } from "@/server/offers";
import { cancelRequest, getRequestForActor, listRequestsBySender } from "@/server/requests";
import { matchesForRequest, searchOffers } from "@/server/search";
import { requestBooking } from "@/server/bookings";
import { searchQuerySchema } from "@/server/validation";
import { ABJ, DKR, db, errorCode, inDays, makeOffer, makeRequest, makeUser, offerInput, resetDb } from "../helpers";

beforeEach(resetDb);

const query = (o: Record<string, string> = {}) =>
  searchQuerySchema.parse({ origin: DKR, destination: ABJ, weightKg: "5", ...o });

describe("publication d'une offre (voyageur)", () => {
  it("exige un profil voyageur", async () => {
    const plain = await makeUser();
    expect(await errorCode(makeOffer(plain))).toBe("traveler_profile_required");
  });

  it("publie une offre avec capacité déclarée, sans réservation initiale", async () => {
    const provider = await makeUser({ traveler: true });
    const offer = await makeOffer(provider, { capacityWeightG: 23_000, capacityVolumeL: 60 });
    expect(offer.capacityWeightG).toBe(23_000);
    expect(offer.reservedWeightG).toBe(0);
    expect(offer.status).toBe("published");
    expect(offer.isDemo).toBe(false);
    const mine = await listOffersByProvider(db(), provider);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.availableWeightG).toBe(23_000);
    expect(mine[0]!.availableVolumeL).toBe(60);
  });

  it("refuse un couloir non ouvert (périmètre configurable)", async () => {
    const provider = await makeUser({ traveler: true });
    expect(await errorCode(makeOffer(provider, { originCityId: "fr-paris", destinationCityId: ABJ }))).toBe("route_not_enabled");
    expect(await errorCode(makeOffer(provider, { originCityId: DKR, destinationCityId: DKR }))).toBe("route_not_enabled");
  });

  it("refuse les catégories interdites, un départ passé, une arrivée avant le départ, un dépôt après le départ", async () => {
    const provider = await makeUser({ traveler: true });
    expect(await errorCode(makeOffer(provider, { acceptedCategories: ["clothing", "weapons_ammunition"] }))).toBe("category_prohibited");
    expect(await errorCode(makeOffer(provider, { departureAt: inDays(-1), arrivalEstimatedAt: null, depositCutoffAt: null }))).toBe("departure_in_past");
    expect(await errorCode(makeOffer(provider, { departureAt: inDays(3), arrivalEstimatedAt: inDays(2) }))).toBe("arrival_before_departure");
    expect(await errorCode(makeOffer(provider, { departureAt: inDays(3), depositCutoffAt: inDays(4) }))).toBe("cutoff_after_departure");
  });

  it("la base refuse une réservation de capacité supérieure à la capacité", async () => {
    const provider = await makeUser({ traveler: true });
    const offer = await makeOffer(provider, { capacityWeightG: 5000 });
    await expect(db().update(schema.capacityOffers).set({ reservedWeightG: 5001 }).where(eq(schema.capacityOffers.id, offer.id))).rejects.toThrow();
    await expect(db().update(schema.capacityOffers).set({ reservedWeightG: -1 }).where(eq(schema.capacityOffers.id, offer.id))).rejects.toThrow();
  });

  it("annule une offre : rejette les demandes en attente, refuse s'il existe une réservation acceptée", async () => {
    const provider = await makeUser({ traveler: true });
    const sender = await makeUser();
    const offer = await makeOffer(provider);
    const request = await makeRequest(sender);
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await cancelOffer(db(), provider, offer.id);
    const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
    expect(b!.status).toBe("rejected");
    expect(b!.statusReason).toBe("offer_cancelled");
    expect((await getOfferView(db(), offer.id)).status).toBe("cancelled");
    expect(await errorCode(cancelOffer(db(), provider, offer.id))).toBe("offer_not_published");
  });

  it("seul le propriétaire annule son offre", async () => {
    const provider = await makeUser({ traveler: true });
    const other = await makeUser({ traveler: true });
    const offer = await makeOffer(provider);
    expect(await errorCode(cancelOffer(db(), other, offer.id))).toBe("forbidden");
  });
});

describe("publication d'une demande d'expédition", () => {
  it("publie une demande avec volume calculé et articles par défaut", async () => {
    const sender = await makeUser();
    const request = await makeRequest(sender, { lengthCm: 40, widthCm: 30, heightCm: 20, declaredValueMinor: 50_000, declaredValueCurrency: "XOF" });
    expect(request.volumeL).toBe(24); // 40×30×20 cm = 24 000 cm³ = 24 L
    expect(request.status).toBe("open");
    expect((request.items as unknown[]).length).toBe(1);
    expect(request.isDemo).toBe(false);
    expect(await listRequestsBySender(db(), sender)).toHaveLength(1);
  });

  it("refuse une catégorie interdite et un couloir fermé", async () => {
    const sender = await makeUser();
    expect(await errorCode(makeRequest(sender, { category: "illicit_drugs" }))).toBe("category_prohibited");
    expect(await errorCode(makeRequest(sender, { originCityId: "fr-paris" }))).toBe("route_not_enabled");
  });

  it("refuse une échéance ou une fenêtre déjà passée", async () => {
    const sender = await makeUser();
    expect(await errorCode(makeRequest(sender, { neededBy: inDays(-1) }))).toBe("deadline_in_past");
    expect(await errorCode(makeRequest(sender, { latestDepartureAt: inDays(-1) }))).toBe("window_in_past");
  });

  it("n'est lisible que par son auteur ou un opérateur", async () => {
    const sender = await makeUser();
    const other = await makeUser();
    const operator = await makeUser({ role: "operator" });
    const request = await makeRequest(sender);
    expect(await errorCode(getRequestForActor(db(), other, request.id))).toBe("forbidden");
    expect((await getRequestForActor(db(), operator, request.id)).id).toBe(request.id);
    expect((await getRequestForActor(db(), sender, request.id)).id).toBe(request.id);
  });

  it("peut être annulée tant qu'elle est ouverte ; les réservations en attente sont annulées", async () => {
    const provider = await makeUser({ traveler: true });
    const sender = await makeUser();
    const offer = await makeOffer(provider);
    const request = await makeRequest(sender);
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await cancelRequest(db(), sender, request.id);
    const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
    expect(b!.status).toBe("cancelled");
    expect(await errorCode(cancelRequest(db(), sender, request.id))).toBe("request_not_open");
  });
});

describe("recherche et matching", () => {
  it("retourne les offres compatibles, avec prix total et détail du score", async () => {
    const provider = await makeUser({ traveler: true, name: "Moussa" });
    await makeOffer(provider, { pricePerKgMinor: 3500 });
    const res = await searchOffers(db(), null, query());
    expect(res.results).toHaveLength(1);
    const [r] = res.results;
    expect(r!.match.totalMinor).toBe(17_500);
    expect(r!.match.score).toBeGreaterThan(0);
    expect(r!.offer.provider.displayName).toBe("Moussa");
    expect(r!.offer.hasDepositAddress).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Point de dépôt de test"); // adresse non publique
    expect(res.scoring.validated).toBe(false);
    expect(res.dataset).toBe("real");
  });

  it("exclut les offres incompatibles : poids, catégorie, dépôt clos, départ passé, mauvais sens", async () => {
    const provider = await makeUser({ traveler: true });
    await makeOffer(provider, { capacityWeightG: 2000 }); // trop petite
    await makeOffer(provider, { acceptedCategories: ["books_misc"] }); // catégorie
    await makeOffer(provider, { originCityId: ABJ, destinationCityId: DKR }); // sens inverse
    await makeOffer(provider, { pricePerKgMinor: 2800 }); // seule compatible
    const res = await searchOffers(db(), null, query({ category: "clothing", explain: "1" }));
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.offer.pricePerKgMinor).toBe(2800);
    expect(res.excludedCount).toBe(2);
    const reasons = res.excluded!.flatMap((e) => e.reasons).sort();
    expect(reasons).toEqual(["category_not_accepted", "insufficient_weight"]);
  });

  it("ne montre ni les offres annulées ni celles d'un transporteur suspendu", async () => {
    const admin = await makeUser({ role: "admin" });
    const good = await makeUser({ traveler: true });
    const bad = await makeUser({ traveler: true });
    const cancelled = await makeUser({ traveler: true });
    await makeOffer(good);
    await makeOffer(bad);
    const c = await makeOffer(cancelled);
    await cancelOffer(db(), cancelled, c.id);
    expect((await searchOffers(db(), null, query())).results).toHaveLength(2);
    const { setUserStatus } = await import("@/server/admin");
    await setUserStatus(db(), admin, bad.id, "suspended", "test de suspension");
    expect((await searchOffers(db(), null, query())).results).toHaveLength(1);
  });

  it("n'affiche pas à un expéditeur sa propre offre", async () => {
    const both = await makeUser({ traveler: true });
    await makeOffer(both);
    expect((await searchOffers(db(), both, query())).results).toHaveLength(0);
    expect((await searchOffers(db(), null, query())).results).toHaveLength(1);
  });

  it("applique la fenêtre de dates demandée", async () => {
    const provider = await makeUser({ traveler: true });
    await makeOffer(provider, { departureAt: inDays(3), arrivalEstimatedAt: inDays(4), depositCutoffAt: null });
    await makeOffer(provider, { departureAt: inDays(10), arrivalEstimatedAt: inDays(11), depositCutoffAt: null });
    const early = await searchOffers(db(), null, query({ departureTo: inDays(5).toISOString() }));
    expect(early.results).toHaveLength(1);
    const late = await searchOffers(db(), null, query({ departureFrom: inDays(8).toISOString() }));
    expect(late.results).toHaveLength(1);
    expect(late.results[0]!.offer.departureAt.getTime()).toBeGreaterThan(inDays(8).getTime());
  });

  it("classe par score : prix plus bas et transporteur éprouvé devant", async () => {
    const a = await makeUser({ traveler: true, name: "A cher" });
    const b = await makeUser({ traveler: true, name: "B pas cher" });
    await makeOffer(a, { pricePerKgMinor: 6000 });
    await makeOffer(b, { pricePerKgMinor: 2500 });
    const res = await searchOffers(db(), null, query());
    expect(res.results.map((r) => r.offer.provider.displayName)).toEqual(["B pas cher", "A cher"]);
    expect(res.results[0]!.match.score).toBeGreaterThan(res.results[1]!.match.score);
  });

  it("sépare strictement données réelles et données de démonstration", async () => {
    const real = await makeUser({ traveler: true, name: "Réel" });
    const demo = await makeUser({ traveler: true, demo: true, name: "Démo" });
    await makeOffer(real);
    const demoOffer = await makeOffer(demo);
    expect(demoOffer.isDemo).toBe(true);
    const realResults = await searchOffers(db(), null, query());
    expect(realResults.results.map((r) => r.offer.provider.displayName)).toEqual(["Réel"]);
    const demoResults = await searchOffers(db(), null, query({ demo: "1" }));
    expect(demoResults.results.map((r) => r.offer.provider.displayName)).toEqual(["Démo"]);
    expect(demoResults.dataset).toBe("demo");
    expect(demoResults.results[0]!.offer.isDemo).toBe(true);
  });

  it("propose les offres compatibles pour une demande précise, dans son jeu de données", async () => {
    const provider = await makeUser({ traveler: true });
    const sender = await makeUser();
    const demoProvider = await makeUser({ traveler: true, demo: true });
    await makeOffer(provider);
    await makeOffer(demoProvider);
    const request = await makeRequest(sender, { weightG: 8000 });
    const res = await matchesForRequest(db(), sender, request.id);
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.offer.isDemo).toBe(false);
    const other = await makeUser();
    expect(await errorCode(matchesForRequest(db(), other, request.id))).toBe("forbidden");
  });

  it("refuse un couloir fermé avec une erreur explicite", async () => {
    expect(await errorCode(searchOffers(db(), null, query({ origin: "fr-paris" })))).toBe("route_not_enabled");
  });
});

describe("offres : valeurs par défaut de l'aide de test", () => {
  it("offerInput() est valide pour le couloir de démonstration Dakar → Abidjan", () => {
    const o = offerInput();
    expect(o.originCityId).toBe(DKR);
    expect(o.destinationCityId).toBe(ABJ);
  });
});
