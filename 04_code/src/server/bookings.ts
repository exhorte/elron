import { and, desc, eq, or } from "drizzle-orm";
import { getPlatformFeeBps } from "@/config/app";
import { schema, type Db, type DbOrTx, type Tx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { exclusionReasons } from "@/domain/matching";
import { splitAmounts, type CurrencyCode } from "@/domain/money";
import { generateTrackingCode } from "@/domain/ids";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { ratingsFor } from "./reviews";
import { toMatchOffer, toMatchRequest } from "./search";
import type { BookingCreateInput } from "./validation";

const { bookings, capacityOffers, shipmentRequests, shipments, shipmentItems, shipmentEvents, users, travelerProfiles } = schema;

/**
 * Ordre global des verrous de ligne (évite les interblocages) :
 *   shipment_requests → capacity_offers → bookings → shipments
 * Toute transaction qui verrouille plusieurs de ces tables doit respecter cet ordre.
 */

export type BookingRow = typeof bookings.$inferSelect;

export interface BookingView {
  id: string;
  status: BookingRow["status"];
  requestId: string;
  offerId: string;
  weightG: number;
  pricePerKgMinor: number;
  currency: CurrencyCode;
  subtotalMinor: number;
  platformFeeMinor: number;
  providerNetMinor: number;
  message: string | null;
  statusReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  /** Résumé de la demande (sans coordonnées du destinataire tant que la réservation n'est pas acceptée). */
  request: { category: string; description: string; weightG: number; isDemo: boolean };
  counterpart: { displayName: string; rating: { average: number | null; count: number } };
  shipmentId: string | null;
}

async function loadBookingView(db: DbOrTx, row: BookingRow, viewerIsProvider: boolean): Promise<BookingView> {
  const [req] = await db.select().from(shipmentRequests).where(eq(shipmentRequests.id, row.requestId));
  const [other] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, viewerIsProvider ? row.senderUserId : row.providerUserId));
  const [ship] = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.bookingId, row.id));
  const otherId = viewerIsProvider ? row.senderUserId : row.providerUserId;
  // la contrepartie d'un transporteur est un expéditeur, et inversement
  const otherRating = (await ratingsFor(db, [otherId], viewerIsProvider ? "sender" : "provider")).get(otherId);
  return {
    id: row.id,
    status: row.status,
    requestId: row.requestId,
    offerId: row.offerId,
    weightG: row.weightG,
    pricePerKgMinor: row.pricePerKgMinor,
    currency: row.currency as CurrencyCode,
    subtotalMinor: row.subtotalMinor,
    platformFeeMinor: row.platformFeeMinor,
    providerNetMinor: row.providerNetMinor,
    message: row.message,
    statusReason: row.statusReason,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    request: { category: req!.category, description: req!.description, weightG: req!.weightG, isDemo: req!.isDemo },
    counterpart: { displayName: other?.displayName ?? "—", rating: { average: otherRating?.average ?? null, count: otherRating?.count ?? 0 } },
    shipmentId: ship?.id ?? null,
  };
}

export async function listBookings(db: Db, actor: Actor, as: "sender" | "provider"): Promise<BookingView[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(as === "sender" ? eq(bookings.senderUserId, actor.id) : eq(bookings.providerUserId, actor.id))
    .orderBy(desc(bookings.createdAt));
  return Promise.all(rows.map((r) => loadBookingView(db, r, as === "provider")));
}

/** L'expéditeur demande à réserver de la capacité sur une offre. Aucune capacité n'est réservée à ce stade. */
export async function requestBooking(db: Db, actor: Actor, input: BookingCreateInput, now = new Date()): Promise<BookingRow> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(shipmentRequests).where(eq(shipmentRequests.id, input.requestId)).for("share");
    if (!request) throw notFound("Demande");
    if (request.senderUserId !== actor.id) throw forbidden();
    if (request.status !== "open") throw conflict("request_not_open", "Cette demande n'est plus ouverte");

    const [offerRow] = await tx
      .select({
        offer: capacityOffers,
        providerStatus: users.status,
        identityStatus: travelerProfiles.identityStatus,
      })
      .from(capacityOffers)
      .innerJoin(users, eq(users.id, capacityOffers.providerUserId))
      .leftJoin(travelerProfiles, eq(travelerProfiles.userId, capacityOffers.providerUserId))
      .where(eq(capacityOffers.id, input.offerId));
    if (!offerRow) throw notFound("Offre");
    const offer = offerRow.offer;

    if (offer.isDemo !== request.isDemo) {
      throw invalid("demo_real_mismatch", "Les données de démonstration et les données réelles ne peuvent pas être mélangées");
    }
    const reasons = exclusionReasons(
      toMatchRequest(request),
      toMatchOffer({
        offer,
        providerName: "",
        providerActive: offerRow.providerStatus === "active",
        identityStatus: offerRow.identityStatus,
        stats: { completed: 0, incidents: 0 },
      }),
      now,
    );
    if (reasons.length > 0) throw invalid("offer_incompatible", "Cette offre n'est pas compatible avec la demande", { reasons });

    const feeBps = getPlatformFeeBps();
    const amounts = splitAmounts({ pricePerKgMinor: offer.pricePerKgMinor, weightGrams: request.weightG, feeBps });
    try {
      const [booking] = await tx
        .insert(bookings)
        .values({
          requestId: request.id,
          offerId: offer.id,
          senderUserId: actor.id,
          providerUserId: offer.providerUserId,
          weightG: request.weightG,
          volumeL: request.volumeL,
          pricePerKgMinor: offer.pricePerKgMinor,
          currency: offer.currency,
          subtotalMinor: amounts.subtotalMinor,
          platformFeeMinor: amounts.platformFeeMinor,
          providerNetMinor: amounts.providerNetMinor,
          feeBps,
          message: input.message ?? null,
        })
        .returning();
      await audit(tx, { actorUserId: actor.id, action: "booking.requested", entityType: "booking", entityId: booking!.id });
      return booking!;
    } catch (err) {
      if (isUniqueViolation(err, "bookings_active_pair_key")) {
        throw conflict("booking_already_requested", "Une demande de réservation est déjà en cours pour cette offre");
      }
      throw err;
    }
  });
}

export interface AcceptResult {
  booking: BookingRow;
  shipmentId: string;
  trackingCode: string;
}

/**
 * Le prestataire accepte : réserve la capacité, passe la demande à `booked`, supersede les autres
 * demandes concurrentes, crée le colis et son premier événement — le tout dans UNE transaction.
 * La ligne d'offre est verrouillée (FOR UPDATE) : deux acceptations concurrentes ne peuvent pas
 * dépasser la capacité.
 */
export async function acceptBooking(db: Db, actor: Actor, bookingId: string, now = new Date()): Promise<AcceptResult> {
  return db.transaction(async (tx) => {
    const [preview] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!preview) throw notFound("Réservation");
    if (preview.providerUserId !== actor.id) throw forbidden();

    // Ordre des verrous : demande → offre → réservation.
    const [request] = await tx.select().from(shipmentRequests).where(eq(shipmentRequests.id, preview.requestId)).for("update");
    const [offer] = await tx.select().from(capacityOffers).where(eq(capacityOffers.id, preview.offerId)).for("update");
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!request || !offer || !booking) throw notFound("Réservation");

    if (booking.status !== "requested") throw conflict("booking_not_pending", "Cette réservation n'est plus en attente");
    if (request.status !== "open") throw conflict("request_not_open", "La demande n'est plus ouverte");
    if (offer.status !== "published") throw conflict("offer_not_published", "L'offre n'est plus active");
    if (offer.departureAt <= now) throw conflict("offer_departed", "Le départ est passé");
    const availableWeight = offer.capacityWeightG - offer.reservedWeightG;
    const availableVolume = offer.capacityVolumeL === null ? null : offer.capacityVolumeL - offer.reservedVolumeL;
    if (availableWeight < booking.weightG || (booking.volumeL !== null && availableVolume !== null && availableVolume < booking.volumeL)) {
      throw conflict("insufficient_capacity", "Capacité restante insuffisante");
    }

    await tx
      .update(capacityOffers)
      .set({
        reservedWeightG: offer.reservedWeightG + booking.weightG,
        reservedVolumeL: offer.reservedVolumeL + (booking.volumeL ?? 0),
      })
      .where(eq(capacityOffers.id, offer.id));
    const [accepted] = await tx
      .update(bookings)
      .set({ status: "accepted", decidedAt: now, decidedBy: actor.id })
      .where(eq(bookings.id, booking.id))
      .returning();
    await tx
      .update(bookings)
      .set({ status: "superseded", statusReason: "another_booking_accepted", decidedAt: now })
      .where(and(eq(bookings.requestId, request.id), eq(bookings.status, "requested")));
    await tx.update(shipmentRequests).set({ status: "booked" }).where(eq(shipmentRequests.id, request.id));

    const { id: shipmentId, trackingCode } = await insertShipment(tx, { booking: accepted!, request, now });
    await tx.insert(shipmentEvents).values({
      shipmentId,
      fromStatus: null,
      toStatus: "ACCEPTED",
      actorUserId: actor.id,
      actorRole: "provider",
      occurredAt: now,
      context: { bookingId: booking.id, offerId: offer.id },
    });
    await audit(tx, { actorUserId: actor.id, action: "booking.accepted", entityType: "booking", entityId: booking.id, data: { shipmentId } });
    return { booking: accepted!, shipmentId, trackingCode };
  });
}

async function insertShipment(
  tx: Tx,
  input: { booking: BookingRow; request: typeof shipmentRequests.$inferSelect; now: Date },
): Promise<{ id: string; trackingCode: string }> {
  const { booking, request } = input;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const trackingCode = generateTrackingCode();
    try {
      // Sous-transaction (savepoint) : une collision de code ne doit pas invalider la transaction parente.
      const row = await tx.transaction(async (sp) => {
        const [created] = await sp
          .insert(shipments)
          .values({
            trackingCode,
            bookingId: booking.id,
            requestId: request.id,
            offerId: booking.offerId,
            senderUserId: booking.senderUserId,
            providerUserId: booking.providerUserId,
            routeId: request.routeId,
            weightG: booking.weightG,
            category: request.category,
            description: request.description,
            declaredValueMinor: request.declaredValueMinor,
            declaredValueCurrency: request.declaredValueCurrency,
            receiverName: request.receiverName,
            receiverPhone: request.receiverPhone,
            statusChangedAt: input.now,
          })
          .returning({ id: shipments.id });
        return created!;
      });
      const items = (request.items as Array<{ description: string; quantity: number; declaredValueMinor?: number | null }>) ?? [];
      if (items.length > 0) {
        await tx.insert(shipmentItems).values(
          items.map((i) => ({ shipmentId: row.id, description: i.description, quantity: i.quantity ?? 1, declaredValueMinor: i.declaredValueMinor ?? null })),
        );
      }
      return { id: row.id, trackingCode };
    } catch (err) {
      if (isUniqueViolation(err, "shipments_tracking_code_key")) continue;
      throw err;
    }
  }
  throw new Error("Impossible de générer un code de suivi unique");
}

export async function rejectBooking(db: Db, actor: Actor, bookingId: string, reason: string | null | undefined, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!booking) throw notFound("Réservation");
    if (booking.providerUserId !== actor.id) throw forbidden();
    if (booking.status !== "requested") throw conflict("booking_not_pending", "Cette réservation n'est plus en attente");
    await tx
      .update(bookings)
      .set({ status: "rejected", statusReason: reason ?? null, decidedAt: now, decidedBy: actor.id })
      .where(eq(bookings.id, bookingId));
    await audit(tx, { actorUserId: actor.id, action: "booking.rejected", entityType: "booking", entityId: bookingId });
  });
}

/** L'expéditeur retire sa demande tant qu'elle est en attente (après acceptation : annuler le colis). */
export async function cancelPendingBooking(db: Db, actor: Actor, bookingId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!booking) throw notFound("Réservation");
    if (booking.senderUserId !== actor.id) throw forbidden();
    if (booking.status !== "requested") {
      throw conflict("booking_not_pending", booking.status === "accepted" ? "Réservation acceptée : annulez le colis" : "Réservation déjà clôturée");
    }
    await tx
      .update(bookings)
      .set({ status: "cancelled", statusReason: "cancelled_by_sender", decidedAt: now, decidedBy: actor.id })
      .where(eq(bookings.id, bookingId));
    await audit(tx, { actorUserId: actor.id, action: "booking.cancelled", entityType: "booking", entityId: bookingId });
  });
}

export async function getBookingForParty(db: Db, actor: Actor, bookingId: string): Promise<BookingView> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), or(eq(bookings.senderUserId, actor.id), eq(bookings.providerUserId, actor.id))));
  if (!row) throw notFound("Réservation");
  return loadBookingView(db, row, row.providerUserId === actor.id);
}
