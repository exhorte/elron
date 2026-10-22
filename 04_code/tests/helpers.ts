import { eq, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db/client";
import type { Actor, PlatformRole } from "@/server/actor";
import { registerUser } from "@/server/auth";
import { acceptBooking, requestBooking } from "@/server/bookings";
import { createOffer } from "@/server/offers";
import { createRequest } from "@/server/requests";
import type { OfferCreateInput, RequestCreateInput } from "@/server/validation";

export const DKR = "sn-dakar";
export const ABJ = "ci-abidjan";
export const DAY = 24 * 60 * 60 * 1000;

export const db = (): Db => getDb();

export const inDays = (days: number, from = new Date()) => new Date(from.getTime() + days * DAY);

export async function resetDb(): Promise<void> {
  await getDb().execute(sql`
    TRUNCATE users, sessions, traveler_profiles, capacity_offers, shipment_requests, bookings,
             shipments, shipment_items, shipment_events, audit_logs RESTART IDENTITY CASCADE`);
}

let counter = 0;

export async function makeUser(
  opts: { traveler?: boolean; role?: PlatformRole; demo?: boolean; name?: string; email?: string } = {},
): Promise<Actor> {
  counter += 1;
  const actor = await registerUser(getDb(), {
    email: opts.email ?? `user${counter}-${Date.now()}@example.test`,
    password: "correct-horse-battery",
    displayName: opts.name ?? `Utilisateur ${counter}`,
    asTraveler: opts.traveler ?? false,
  });
  if (opts.role || opts.demo) {
    await getDb()
      .update(schema.users)
      .set({ platformRole: opts.role ?? "user", isDemo: opts.demo ?? false })
      .where(eq(schema.users.id, actor.id));
    return { ...actor, platformRole: opts.role ?? "user", isDemo: opts.demo ?? false };
  }
  return actor;
}

export function offerInput(overrides: Partial<OfferCreateInput> = {}): OfferCreateInput {
  return {
    originCityId: DKR,
    destinationCityId: ABJ,
    transportMode: "air",
    departureAt: inDays(3),
    arrivalEstimatedAt: inDays(4),
    depositCutoffAt: inDays(2),
    capacityWeightG: 20_000,
    capacityVolumeL: null,
    pricePerKgMinor: 3500,
    currency: "XOF",
    acceptedCategories: ["clothing", "books_misc", "documents"],
    handoverTerms: null,
    depositAddress: "Point de dépôt de test",
    pickupAddress: "Point de retrait de test",
    ...overrides,
  };
}

export function requestInput(overrides: Partial<RequestCreateInput> = {}): RequestCreateInput {
  return {
    originCityId: DKR,
    destinationCityId: ABJ,
    weightG: 5000,
    category: "clothing",
    description: "Vêtements pour la famille",
    items: [],
    budgetIsStrict: false,
    deadlineIsStrict: false,
    receiverName: "Awa Koné",
    receiverPhone: "+22507000000",
    ...overrides,
  };
}

export const makeOffer = (provider: Actor, overrides: Partial<OfferCreateInput> = {}) =>
  createOffer(getDb(), provider, offerInput(overrides));

export const makeRequest = (sender: Actor, overrides: Partial<RequestCreateInput> = {}) =>
  createRequest(getDb(), sender, requestInput(overrides));

/** Parcours complet jusqu'à un colis ACCEPTED. */
export async function makeAcceptedShipment(
  opts: { weightG?: number; capacityWeightG?: number } = {},
): Promise<{ sender: Actor; provider: Actor; offerId: string; requestId: string; bookingId: string; shipmentId: string; trackingCode: string }> {
  const provider = await makeUser({ traveler: true, name: "Moussa Transporteur" });
  const sender = await makeUser({ name: "Fatou Expéditrice" });
  const offer = await makeOffer(provider, opts.capacityWeightG ? { capacityWeightG: opts.capacityWeightG } : {});
  const request = await makeRequest(sender, opts.weightG ? { weightG: opts.weightG } : {});
  const booking = await requestBooking(getDb(), sender, { requestId: request.id, offerId: offer.id });
  const accepted = await acceptBooking(getDb(), provider, booking.id);
  return {
    sender,
    provider,
    offerId: offer.id,
    requestId: request.id,
    bookingId: booking.id,
    shipmentId: accepted.shipmentId,
    trackingCode: accepted.trackingCode,
  };
}

/**
 * Drizzle enveloppe les erreurs pg (« Failed query … ») : le message utile (contrainte, trigger) est
 * dans `cause`. Renvoie tout le texte de la chaîne d'erreurs, ou « no_error ».
 */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const parts: string[] = [];
    let current = err as { message?: unknown; constraint?: unknown; code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      parts.push(String(current.message ?? ""), String(current.constraint ?? ""), String(current.code ?? ""));
      current = current.cause as typeof current;
    }
    return parts.join(" | ");
  }
  return "no_error";
}

/** Exécute une promesse qui doit échouer avec un AppError et renvoie son code. */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    return e.code ?? `unexpected:${e.message}`;
  }
  return "no_error";
}
