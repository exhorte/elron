import { and, desc, eq } from "drizzle-orm";
import { categoryPolicy } from "@/config/goods-policy";
import { schema, type Db, type DbOrTx } from "@/db/client";
import type { CurrencyCode } from "@/domain/money";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { cityNames, requireEnabledRoute } from "./geo";
import { ratingsFor } from "./reviews";
import type { OfferCreateInput } from "./validation";

const { capacityOffers, travelerProfiles, users, bookings, routes } = schema;

export type OfferRow = typeof capacityOffers.$inferSelect;

export interface OfferView {
  id: string;
  routeId: string;
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  provider: { id: string; displayName: string; identityStatus: string | null; rating: { average: number | null; count: number } };
  transportMode: OfferRow["transportMode"];
  departureAt: Date;
  arrivalEstimatedAt: Date | null;
  depositCutoffAt: Date | null;
  capacityWeightG: number;
  availableWeightG: number;
  capacityVolumeL: number | null;
  availableVolumeL: number | null;
  pricePerKgMinor: number;
  currency: CurrencyCode;
  acceptedCategories: string[];
  handoverTerms: string | null;
  /** Les adresses ne sont pas publiques : elles ne sont révélées qu'aux parties d'un colis accepté. */
  hasDepositAddress: boolean;
  status: OfferRow["status"];
  isDemo: boolean;
}

export async function toOfferViews(
  db: DbOrTx,
  rows: Array<{ offer: OfferRow; providerName: string; identityStatus: string | null }>,
): Promise<OfferView[]> {
  if (rows.length === 0) return [];
  const names = await cityNames(db);
  const routeRows = await db.select().from(routes);
  const routeById = new Map(routeRows.map((r) => [r.id, r]));
  const ratings = await ratingsFor(db, rows.map((r) => r.offer.providerUserId), "provider");
  return rows.map(({ offer, providerName, identityStatus }) => {
    const route = routeById.get(offer.routeId)!;
    return {
      id: offer.id,
      routeId: offer.routeId,
      origin: { id: route.originCityId, name: names.get(route.originCityId)?.name ?? route.originCityId },
      destination: { id: route.destinationCityId, name: names.get(route.destinationCityId)?.name ?? route.destinationCityId },
      provider: {
        id: offer.providerUserId,
        displayName: providerName,
        identityStatus,
        rating: { average: ratings.get(offer.providerUserId)?.average ?? null, count: ratings.get(offer.providerUserId)?.count ?? 0 },
      },
      transportMode: offer.transportMode,
      departureAt: offer.departureAt,
      arrivalEstimatedAt: offer.arrivalEstimatedAt,
      depositCutoffAt: offer.depositCutoffAt,
      capacityWeightG: offer.capacityWeightG,
      availableWeightG: offer.capacityWeightG - offer.reservedWeightG,
      capacityVolumeL: offer.capacityVolumeL,
      availableVolumeL: offer.capacityVolumeL === null ? null : offer.capacityVolumeL - offer.reservedVolumeL,
      pricePerKgMinor: offer.pricePerKgMinor,
      currency: offer.currency as CurrencyCode,
      acceptedCategories: offer.acceptedCategories,
      handoverTerms: offer.handoverTerms,
      hasDepositAddress: Boolean(offer.depositAddress),
      status: offer.status,
      isDemo: offer.isDemo,
    };
  });
}

export async function createOffer(db: Db, actor: Actor, input: OfferCreateInput, now = new Date()): Promise<OfferRow> {
  const [profile] = await db.select({ userId: travelerProfiles.userId }).from(travelerProfiles).where(eq(travelerProfiles.userId, actor.id));
  if (!profile) throw forbidden("traveler_profile_required", "Créez d'abord un profil voyageur/transporteur");

  const route = await requireEnabledRoute(db, input.originCityId, input.destinationCityId);

  const prohibited = input.acceptedCategories.filter((c) => categoryPolicy(c) === "prohibited");
  if (prohibited.length > 0) {
    throw invalid("category_prohibited", "Catégorie interdite par la politique de la plateforme", { categories: prohibited });
  }
  if (input.departureAt <= now) throw invalid("departure_in_past", "Le départ doit être dans le futur");
  if (input.arrivalEstimatedAt && input.arrivalEstimatedAt < input.departureAt) {
    throw invalid("arrival_before_departure", "L'arrivée précède le départ");
  }
  if (input.depositCutoffAt && input.depositCutoffAt > input.departureAt) {
    throw invalid("cutoff_after_departure", "La date limite de dépôt doit précéder le départ");
  }

  return db.transaction(async (tx) => {
    const [offer] = await tx
      .insert(capacityOffers)
      .values({
        providerUserId: actor.id,
        routeId: route.id,
        transportMode: input.transportMode,
        departureAt: input.departureAt,
        arrivalEstimatedAt: input.arrivalEstimatedAt ?? null,
        depositCutoffAt: input.depositCutoffAt ?? null,
        capacityWeightG: input.capacityWeightG,
        capacityVolumeL: input.capacityVolumeL ?? null,
        pricePerKgMinor: input.pricePerKgMinor,
        currency: input.currency,
        acceptedCategories: [...new Set(input.acceptedCategories)],
        handoverTerms: input.handoverTerms ?? null,
        depositAddress: input.depositAddress ?? null,
        pickupAddress: input.pickupAddress ?? null,
        isDemo: actor.isDemo,
      })
      .returning();
    await audit(tx, { actorUserId: actor.id, action: "offer.created", entityType: "capacity_offer", entityId: offer!.id });
    return offer!;
  });
}

export async function listOffersByProvider(db: Db, actor: Actor): Promise<OfferView[]> {
  const rows = await db
    .select({ offer: capacityOffers, providerName: users.displayName, identityStatus: travelerProfiles.identityStatus })
    .from(capacityOffers)
    .innerJoin(users, eq(users.id, capacityOffers.providerUserId))
    .leftJoin(travelerProfiles, eq(travelerProfiles.userId, capacityOffers.providerUserId))
    .where(eq(capacityOffers.providerUserId, actor.id))
    .orderBy(desc(capacityOffers.departureAt));
  return toOfferViews(db, rows);
}

export async function getOfferView(db: Db, offerId: string): Promise<OfferView> {
  const rows = await db
    .select({ offer: capacityOffers, providerName: users.displayName, identityStatus: travelerProfiles.identityStatus })
    .from(capacityOffers)
    .innerJoin(users, eq(users.id, capacityOffers.providerUserId))
    .leftJoin(travelerProfiles, eq(travelerProfiles.userId, capacityOffers.providerUserId))
    .where(eq(capacityOffers.id, offerId))
    .limit(1);
  if (!rows[0]) throw notFound("Offre");
  return (await toOfferViews(db, rows))[0]!;
}

/** Annule une offre. Refusée s'il existe une réservation acceptée ; les demandes en attente sont rejetées. */
export async function cancelOffer(db: Db, actor: Actor, offerId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [offer] = await tx.select().from(capacityOffers).where(eq(capacityOffers.id, offerId)).for("update");
    if (!offer) throw notFound("Offre");
    if (offer.providerUserId !== actor.id) throw forbidden();
    if (offer.status !== "published") throw conflict("offer_not_published", "Cette offre n'est plus active");
    const [accepted] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.offerId, offerId), eq(bookings.status, "accepted")))
      .limit(1);
    if (accepted) throw conflict("offer_has_accepted_bookings", "Des réservations acceptées existent : annulez les colis concernés d'abord");
    await tx
      .update(bookings)
      .set({ status: "rejected", statusReason: "offer_cancelled", decidedAt: now, decidedBy: actor.id })
      .where(and(eq(bookings.offerId, offerId), eq(bookings.status, "requested")));
    await tx.update(capacityOffers).set({ status: "cancelled" }).where(eq(capacityOffers.id, offerId));
    await audit(tx, { actorUserId: actor.id, action: "offer.cancelled", entityType: "capacity_offer", entityId: offerId });
  });
}
