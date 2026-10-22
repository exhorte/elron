import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { TRACKING_CODE_PATTERN } from "@/domain/ids";
import {
  acceptBooking,
  cancelPendingBooking,
  getBookingForParty,
  listBookings,
  rejectBooking,
  requestBooking,
} from "@/server/bookings";
import { db, errorCode, inDays, makeOffer, makeRequest, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);
afterEach(() => {
  process.env.PLATFORM_FEE_BPS = "0";
});

async function setup(opts: { capacityWeightG?: number; weightG?: number } = {}) {
  const provider = await makeUser({ traveler: true, name: "Moussa" });
  const sender = await makeUser({ name: "Fatou" });
  const offer = await makeOffer(provider, { capacityWeightG: opts.capacityWeightG ?? 20_000 });
  const request = await makeRequest(sender, { weightG: opts.weightG ?? 5000 });
  return { provider, sender, offer, request };
}

describe("demande de réservation", () => {
  it("fige le prix et les montants sans réserver de capacité", async () => {
    const { sender, offer, request } = await setup();
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id, message: "Départ possible mardi ?" });
    expect(booking.status).toBe("requested");
    expect(booking.pricePerKgMinor).toBe(3500);
    expect(booking.currency).toBe("XOF");
    expect(booking.weightG).toBe(5000);
    expect(booking.subtotalMinor).toBe(17_500);
    expect(booking.platformFeeMinor).toBe(0);
    expect(booking.providerNetMinor).toBe(17_500);
    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(0);
  });

  it("garde les montants cohérents avec une commission configurée", async () => {
    process.env.PLATFORM_FEE_BPS = "500";
    const { sender, offer, request } = await setup();
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(booking.feeBps).toBe(500);
    expect(booking.subtotalMinor).toBe(17_500);
    expect(booking.platformFeeMinor).toBe(875);
    expect(booking.providerNetMinor).toBe(16_625);
    expect(booking.providerNetMinor + booking.platformFeeMinor).toBe(booking.subtotalMinor);
  });

  it("le prix figé ne change pas si l'offre est modifiée ensuite", async () => {
    const { sender, offer, request } = await setup();
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await db().update(schema.capacityOffers).set({ pricePerKgMinor: 9999 }).where(eq(schema.capacityOffers.id, offer.id));
    const view = await getBookingForParty(db(), sender, booking.id);
    expect(view.pricePerKgMinor).toBe(3500);
    expect(view.subtotalMinor).toBe(17_500);
  });

  it("empêche la double réservation de la même demande auprès de la même offre", async () => {
    const { sender, offer, request } = await setup();
    await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(await errorCode(requestBooking(db(), sender, { requestId: request.id, offerId: offer.id }))).toBe("booking_already_requested");
    const rows = await db().select().from(schema.bookings);
    expect(rows).toHaveLength(1);
  });

  it("autorise plusieurs offres pour une même demande, et la même offre après rejet", async () => {
    const { provider, sender, offer, request } = await setup();
    const other = await makeUser({ traveler: true });
    const offer2 = await makeOffer(other);
    const b1 = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await requestBooking(db(), sender, { requestId: request.id, offerId: offer2.id });
    await rejectBooking(db(), provider, b1.id, "Complet");
    const again = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(again.id).not.toBe(b1.id);
  });

  it("refuse si la demande n'est pas celle de l'acteur", async () => {
    const { offer, request } = await setup();
    const stranger = await makeUser();
    expect(await errorCode(requestBooking(db(), stranger, { requestId: request.id, offerId: offer.id }))).toBe("forbidden");
  });

  it("refuse une offre incompatible avec la liste des raisons", async () => {
    const { sender, offer } = await setup({ capacityWeightG: 3000 });
    const big = await makeRequest(sender, { weightG: 6000 });
    try {
      await requestBooking(db(), sender, { requestId: big.id, offerId: offer.id });
      expect.unreachable();
    } catch (err) {
      const e = err as { code: string; details: { reasons: string[] } };
      expect(e.code).toBe("offer_incompatible");
      expect(e.details.reasons).toContain("insufficient_weight");
    }
  });

  it("refuse de réserver sa propre offre", async () => {
    const both = await makeUser({ traveler: true });
    const offer = await makeOffer(both);
    const request = await makeRequest(both);
    try {
      await requestBooking(db(), both, { requestId: request.id, offerId: offer.id });
      expect.unreachable();
    } catch (err) {
      expect((err as { details: { reasons: string[] } }).details.reasons).toContain("own_offer");
    }
  });

  it("refuse de mélanger démonstration et réel", async () => {
    const demoProvider = await makeUser({ traveler: true, demo: true });
    const sender = await makeUser();
    const offer = await makeOffer(demoProvider);
    const request = await makeRequest(sender);
    expect(await errorCode(requestBooking(db(), sender, { requestId: request.id, offerId: offer.id }))).toBe("demo_real_mismatch");
  });

  it("refuse une catégorie non acceptée et une demande déjà réservée", async () => {
    const { provider, sender, offer, request } = await setup();
    const electronics = await makeRequest(sender, { category: "electronics" });
    expect(await errorCode(requestBooking(db(), sender, { requestId: electronics.id, offerId: offer.id }))).toBe("offer_incompatible");
    const b = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await acceptBooking(db(), provider, b.id);
    const offer2 = await makeOffer(await makeUser({ traveler: true }));
    expect(await errorCode(requestBooking(db(), sender, { requestId: request.id, offerId: offer2.id }))).toBe("request_not_open");
  });

  it("respecte la capacité restante au moment de la demande", async () => {
    const { provider, sender, offer } = await setup({ capacityWeightG: 10_000 });
    const sender2 = await makeUser();
    const r1 = await makeRequest(sender, { weightG: 6000 });
    const r2 = await makeRequest(sender2, { weightG: 6000 });
    const b1 = await requestBooking(db(), sender, { requestId: r1.id, offerId: offer.id });
    await acceptBooking(db(), provider, b1.id);
    expect(await errorCode(requestBooking(db(), sender2, { requestId: r2.id, offerId: offer.id }))).toBe("offer_incompatible");
  });
});

describe("acceptation", () => {
  it("réserve la capacité, crée le colis et son premier événement dans la même transaction", async () => {
    const { provider, sender, offer, request } = await setup();
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    const result = await acceptBooking(db(), provider, booking.id);

    expect(result.booking.status).toBe("accepted");
    expect(result.trackingCode).toMatch(TRACKING_CODE_PATTERN);

    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(5000);
    const [r] = await db().select().from(schema.shipmentRequests).where(eq(schema.shipmentRequests.id, request.id));
    expect(r!.status).toBe("booked");

    const [s] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, result.shipmentId));
    expect(s!.status).toBe("ACCEPTED");
    expect(s!.senderUserId).toBe(sender.id);
    expect(s!.providerUserId).toBe(provider.id);
    expect(s!.weightG).toBe(5000);
    expect(s!.deliveryCodeHash).toBeNull(); // aucun code tant que l'expéditeur n'en génère pas

    const events = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s!.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "ACCEPTED", actorUserId: provider.id, actorRole: "provider" });

    const items = await db().select().from(schema.shipmentItems).where(eq(schema.shipmentItems.shipmentId, s!.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toContain("Vêtements");
  });

  it("seul le prestataire de l'offre accepte", async () => {
    const { provider, sender, offer, request } = await setup();
    const booking = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(await errorCode(acceptBooking(db(), sender, booking.id))).toBe("forbidden");
    expect(await errorCode(acceptBooking(db(), await makeUser({ traveler: true }), booking.id))).toBe("forbidden");
    expect(await errorCode(acceptBooking(db(), provider, "00000000-0000-4000-8000-000000000000"))).toBe("not_found");
  });

  it("supplante les autres demandes concurrentes de la même demande", async () => {
    const { provider, sender, offer, request } = await setup();
    const other = await makeUser({ traveler: true });
    const offer2 = await makeOffer(other);
    const b1 = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    const b2 = await requestBooking(db(), sender, { requestId: request.id, offerId: offer2.id });
    await acceptBooking(db(), provider, b1.id);
    const [row2] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, b2.id));
    expect(row2!.status).toBe("superseded");
    expect(await errorCode(acceptBooking(db(), other, b2.id))).toBe("booking_not_pending");
  });

  it("refuse d'accepter deux fois, après rejet, ou après le départ", async () => {
    const { provider, sender, offer, request } = await setup();
    const b = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(await errorCode(acceptBooking(db(), provider, b.id, inDays(5)))).toBe("offer_departed");
    await acceptBooking(db(), provider, b.id);
    expect(await errorCode(acceptBooking(db(), provider, b.id))).toBe("booking_not_pending");
  });

  it("refuse si la capacité a été consommée entre-temps", async () => {
    const { provider, sender, offer } = await setup({ capacityWeightG: 8000 });
    const sender2 = await makeUser();
    const r1 = await makeRequest(sender, { weightG: 5000 });
    const r2 = await makeRequest(sender2, { weightG: 5000 });
    const b1 = await requestBooking(db(), sender, { requestId: r1.id, offerId: offer.id });
    const b2 = await requestBooking(db(), sender2, { requestId: r2.id, offerId: offer.id });
    await acceptBooking(db(), provider, b1.id);
    expect(await errorCode(acceptBooking(db(), provider, b2.id))).toBe("insufficient_capacity");
    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(5000);
  });
});

describe("refus et annulation", () => {
  it("le prestataire refuse ; la demande reste ouverte et aucune capacité n'est consommée", async () => {
    const { provider, sender, offer, request } = await setup();
    const b = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(await errorCode(rejectBooking(db(), sender, b.id, null))).toBe("forbidden");
    await rejectBooking(db(), provider, b.id, "Plus de place");
    const [row] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, b.id));
    expect(row).toMatchObject({ status: "rejected", statusReason: "Plus de place", decidedBy: provider.id });
    const [r] = await db().select().from(schema.shipmentRequests).where(eq(schema.shipmentRequests.id, request.id));
    expect(r!.status).toBe("open");
    expect(await errorCode(rejectBooking(db(), provider, b.id, null))).toBe("booking_not_pending");
  });

  it("l'expéditeur retire sa demande en attente, mais pas une réservation acceptée", async () => {
    const { provider, sender, offer, request } = await setup();
    const b = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    expect(await errorCode(cancelPendingBooking(db(), provider, b.id))).toBe("forbidden");
    await cancelPendingBooking(db(), sender, b.id);
    const b2 = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    await acceptBooking(db(), provider, b2.id);
    expect(await errorCode(cancelPendingBooking(db(), sender, b2.id))).toBe("booking_not_pending");
  });

  it("liste les réservations par rôle sans exposer les coordonnées du destinataire", async () => {
    const { provider, sender, offer, request } = await setup();
    await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    const asProvider = await listBookings(db(), provider, "provider");
    const asSender = await listBookings(db(), sender, "sender");
    expect(asProvider).toHaveLength(1);
    expect(asSender).toHaveLength(1);
    expect(asProvider[0]!.counterpart.displayName).toBe("Fatou");
    expect(asSender[0]!.counterpart.displayName).toBe("Moussa");
    expect(JSON.stringify(asProvider)).not.toContain("Awa Koné");
    expect(JSON.stringify(asProvider)).not.toContain("+22507000000");
    expect(await listBookings(db(), await makeUser(), "provider")).toHaveLength(0);
    expect(await errorCode(getBookingForParty(db(), await makeUser(), asSender[0]!.id))).toBe("not_found");
  });
});

describe("concurrence (verrous de lignes)", () => {
  it("deux acceptations simultanées ne peuvent pas dépasser la capacité", async () => {
    const provider = await makeUser({ traveler: true });
    const offer = await makeOffer(provider, { capacityWeightG: 8000 });
    const senders = await Promise.all([makeUser(), makeUser()]);
    const requests = await Promise.all(senders.map((s) => makeRequest(s, { weightG: 5000 })));
    const bookings = await Promise.all(senders.map((s, i) => requestBooking(db(), s, { requestId: requests[i]!.id, offerId: offer.id })));

    const results = await Promise.allSettled(bookings.map((b) => acceptBooking(db(), provider, b.id)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0]!.reason as { code: string }).code).toBe("insufficient_capacity");

    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(5000);
    expect(await db().select().from(schema.shipments)).toHaveLength(1);
  });

  it("dix acceptations simultanées pour trois places : exactement trois réussissent", async () => {
    const provider = await makeUser({ traveler: true });
    const offer = await makeOffer(provider, { capacityWeightG: 15_000 });
    const senders = await Promise.all(Array.from({ length: 10 }, () => makeUser()));
    const requests = await Promise.all(senders.map((s) => makeRequest(s, { weightG: 5000 })));
    const bookings = await Promise.all(senders.map((s, i) => requestBooking(db(), s, { requestId: requests[i]!.id, offerId: offer.id })));

    const results = await Promise.allSettled(bookings.map((b) => acceptBooking(db(), provider, b.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("insufficient_capacity");
    }
    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(15_000);
    expect(await db().select().from(schema.shipments)).toHaveLength(3);
    const accepted = await db().select().from(schema.bookings).where(eq(schema.bookings.status, "accepted"));
    expect(accepted).toHaveLength(3);
  });

  it("une même demande acceptée simultanément par deux transporteurs ne produit qu'un colis", async () => {
    const sender = await makeUser();
    const p1 = await makeUser({ traveler: true });
    const p2 = await makeUser({ traveler: true });
    const o1 = await makeOffer(p1);
    const o2 = await makeOffer(p2);
    const request = await makeRequest(sender);
    const b1 = await requestBooking(db(), sender, { requestId: request.id, offerId: o1.id });
    const b2 = await requestBooking(db(), sender, { requestId: request.id, offerId: o2.id });

    const results = await Promise.allSettled([acceptBooking(db(), p1, b1.id), acceptBooking(db(), p2, b2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().select().from(schema.shipments)).toHaveLength(1);
    const offers = await db().select().from(schema.capacityOffers);
    expect(offers.map((o) => o.reservedWeightG).sort((a, b) => a - b)).toEqual([0, 5000]);
    const accepted = await db().select().from(schema.bookings).where(eq(schema.bookings.status, "accepted"));
    expect(accepted).toHaveLength(1);
  });

  it("un double clic (même réservation acceptée deux fois en parallèle) ne crée qu'un colis", async () => {
    const { provider, sender, offer, request } = await setup();
    const b = await requestBooking(db(), sender, { requestId: request.id, offerId: offer.id });
    const results = await Promise.allSettled([acceptBooking(db(), provider, b.id), acceptBooking(db(), provider, b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe("booking_not_pending");
    expect(await db().select().from(schema.shipments)).toHaveLength(1);
    const [o] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, offer.id));
    expect(o!.reservedWeightG).toBe(5000);
  });

  it("deux demandes de réservation identiques en parallèle : une seule est créée", async () => {
    const { sender, offer, request } = await setup();
    const results = await Promise.allSettled([
      requestBooking(db(), sender, { requestId: request.id, offerId: offer.id }),
      requestBooking(db(), sender, { requestId: request.id, offerId: offer.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("booking_already_requested");
  });
});
