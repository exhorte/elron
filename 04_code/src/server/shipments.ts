import { and, asc, desc, eq, or } from "drizzle-orm";
import { getDeliveryCodePepper } from "@/config/app";
import { schema, type Db, type Tx } from "@/db/client";
import {
  HANDOVER_CONFIG,
  checkCodeState,
  deliveryCodeExpiry,
  generateDeliveryCode,
  hashDeliveryCode,
  verifyDeliveryCode,
} from "@/domain/handover";
import { TRACKING_CODE_PATTERN } from "@/domain/ids";
import type { CurrencyCode } from "@/domain/money";
import {
  NOTE_REQUIRED_FOR,
  STATUS_LABELS_FR,
  allowedTargets,
  canTransition,
  isKnownTransition,
  type ActorRole,
  type ShipmentStatus,
} from "@/domain/workflow";
import { isOperator, type Actor } from "./actor";
import { audit } from "./audit";
import { AppError, conflict, forbidden, invalid, locked, notFound } from "./errors";
import { cityNames } from "./geo";
import type { TransitionInput } from "./validation";

const { shipments, shipmentEvents, shipmentItems, shipmentRequests, capacityOffers, bookings, users, travelerProfiles, routes } = schema;

type ShipmentRow = typeof shipments.$inferSelect;

/** Rôle de l'acteur sur ce colis : partie (expéditeur/prestataire) d'abord, sinon opérateur, sinon aucun accès. */
export function resolveRole(actor: Actor, shipment: Pick<ShipmentRow, "senderUserId" | "providerUserId">): ActorRole | null {
  if (actor.id === shipment.senderUserId) return "sender";
  if (actor.id === shipment.providerUserId) return "provider";
  if (isOperator(actor)) return "operator";
  return null;
}

const CODE_ACTIVE_STATUSES: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  "ACCEPTED",
  "HANDED_OVER",
  "IN_TRANSIT",
  "ARRIVED",
  "OUT_FOR_DELIVERY",
  "DELIVERY_FAILED",
]);
const DELIVERABLE_STATUSES: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>(["ARRIVED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"]);
const MAX_CODE_GENERATIONS = 5;

// ───────────────────────── Lecture

export interface ShipmentEventView {
  id: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  label: string;
  actorRole: ActorRole;
  actorName: string | null;
  note: string | null;
  proofs: unknown;
  occurredAt: Date;
}

export interface ShipmentView {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  statusLabel: string;
  statusChangedAt: Date;
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  weightG: number;
  category: string;
  description: string;
  items: Array<{ description: string; quantity: number; declaredValueMinor: number | null }>;
  declaredValue: { minor: number; currency: CurrencyCode } | null;
  sender: { id: string; displayName: string };
  provider: { id: string; displayName: string; identityStatus: string | null };
  receiver: { name: string; phone: string };
  offer: {
    id: string;
    departureAt: Date;
    arrivalEstimatedAt: Date | null;
    depositCutoffAt: Date | null;
    depositAddress: string | null;
    pickupAddress: string | null;
    handoverTerms: string | null;
  };
  price: { subtotalMinor: number; currency: CurrencyCode } | null;
  viewerRole: ActorRole;
  allowedTransitions: ShipmentStatus[];
  deliveryCode: {
    generated: boolean;
    generation: number;
    expiresAt: Date | null;
    attemptsLeft: number | null;
    locked: boolean;
    consumed: boolean;
    canGenerate: boolean;
  };
  events: ShipmentEventView[];
  isDemo: boolean;
}

export async function getShipmentView(db: Db, actor: Actor, shipmentId: string): Promise<ShipmentView> {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment) throw notFound("Colis");
  const role = resolveRole(actor, shipment);
  if (!role) throw notFound("Colis");
  return buildView(db, shipment, role);
}

async function buildView(db: Db, shipment: ShipmentRow, role: ActorRole): Promise<ShipmentView> {
  const names = await cityNames(db);
  const [route] = await db.select().from(routes).where(eq(routes.id, shipment.routeId));
  const [offer] = await db.select().from(capacityOffers).where(eq(capacityOffers.id, shipment.offerId));
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, shipment.bookingId));
  const [request] = await db.select({ isDemo: shipmentRequests.isDemo }).from(shipmentRequests).where(eq(shipmentRequests.id, shipment.requestId));
  const [sender] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, shipment.senderUserId));
  const [provider] = await db
    .select({ id: users.id, displayName: users.displayName, identityStatus: travelerProfiles.identityStatus })
    .from(users)
    .leftJoin(travelerProfiles, eq(travelerProfiles.userId, users.id))
    .where(eq(users.id, shipment.providerUserId));
  const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, shipment.id));
  const eventRows = await db
    .select({ event: shipmentEvents, actorName: users.displayName })
    .from(shipmentEvents)
    .leftJoin(users, eq(users.id, shipmentEvents.actorUserId))
    .where(eq(shipmentEvents.shipmentId, shipment.id))
    .orderBy(asc(shipmentEvents.id));

  const attemptsLeft = shipment.deliveryCodeHash ? Math.max(0, HANDOVER_CONFIG.maxAttempts - shipment.deliveryCodeAttempts) : null;
  const status = shipment.status;
  return {
    id: shipment.id,
    trackingCode: shipment.trackingCode,
    status,
    statusLabel: STATUS_LABELS_FR[status],
    statusChangedAt: shipment.statusChangedAt,
    origin: { id: route!.originCityId, name: names.get(route!.originCityId)?.name ?? route!.originCityId },
    destination: { id: route!.destinationCityId, name: names.get(route!.destinationCityId)?.name ?? route!.destinationCityId },
    weightG: shipment.weightG,
    category: shipment.category,
    description: shipment.description,
    items: items.map((i) => ({ description: i.description, quantity: i.quantity, declaredValueMinor: i.declaredValueMinor })),
    declaredValue:
      shipment.declaredValueMinor !== null && shipment.declaredValueCurrency
        ? { minor: shipment.declaredValueMinor, currency: shipment.declaredValueCurrency as CurrencyCode }
        : null,
    sender: { id: sender!.id, displayName: sender!.displayName },
    provider: { id: provider!.id, displayName: provider!.displayName, identityStatus: provider!.identityStatus ?? null },
    receiver: { name: shipment.receiverName, phone: shipment.receiverPhone },
    offer: {
      id: offer!.id,
      departureAt: offer!.departureAt,
      arrivalEstimatedAt: offer!.arrivalEstimatedAt,
      depositCutoffAt: offer!.depositCutoffAt,
      depositAddress: offer!.depositAddress,
      pickupAddress: offer!.pickupAddress,
      handoverTerms: offer!.handoverTerms,
    },
    price: booking ? { subtotalMinor: booking.subtotalMinor, currency: booking.currency as CurrencyCode } : null,
    viewerRole: role,
    allowedTransitions: allowedTargets(status, role).filter((to) => !(to === "DELIVERED" && role === "provider")),
    deliveryCode: {
      generated: Boolean(shipment.deliveryCodeHash),
      generation: shipment.deliveryCodeGeneration,
      expiresAt: shipment.deliveryCodeExpiresAt,
      attemptsLeft,
      locked: Boolean(shipment.deliveryCodeLockedAt) || (attemptsLeft !== null && attemptsLeft === 0),
      consumed: Boolean(shipment.deliveryCodeConsumedAt),
      canGenerate:
        role === "sender" &&
        CODE_ACTIVE_STATUSES.has(status) &&
        !shipment.deliveryCodeConsumedAt &&
        shipment.deliveryCodeGeneration < MAX_CODE_GENERATIONS,
    },
    events: eventRows.map(({ event, actorName }) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      label: STATUS_LABELS_FR[event.toStatus],
      actorRole: event.actorRole,
      actorName: actorName ?? null,
      note: event.note,
      proofs: event.proofs,
      occurredAt: event.occurredAt,
    })),
    isDemo: request?.isDemo ?? false,
  };
}

export interface ShipmentSummary {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  statusLabel: string;
  viewerRole: "sender" | "provider";
  weightG: number;
  category: string;
  statusChangedAt: Date;
  originId: string;
  destinationId: string;
  originName: string;
  destinationName: string;
}

export async function listMyShipments(db: Db, actor: Actor): Promise<ShipmentSummary[]> {
  const names = await cityNames(db);
  const rows = await db
    .select({ s: shipments, originId: routes.originCityId, destinationId: routes.destinationCityId })
    .from(shipments)
    .innerJoin(routes, eq(routes.id, shipments.routeId))
    .where(or(eq(shipments.senderUserId, actor.id), eq(shipments.providerUserId, actor.id)))
    .orderBy(desc(shipments.createdAt));
  return rows.map(({ s, originId, destinationId }) => ({
    id: s.id,
    trackingCode: s.trackingCode,
    status: s.status,
    statusLabel: STATUS_LABELS_FR[s.status],
    viewerRole: s.senderUserId === actor.id ? "sender" : "provider",
    weightG: s.weightG,
    category: s.category,
    statusChangedAt: s.statusChangedAt,
    originId,
    destinationId,
    originName: names.get(originId)?.name ?? originId,
    destinationName: names.get(destinationId)?.name ?? destinationId,
  }));
}

/** Suivi public par code : aucune donnée personnelle (pas de noms, téléphones, notes ni preuves). */
export async function trackPublic(db: Db, trackingCode: string) {
  const code = trackingCode.trim().toUpperCase();
  if (!TRACKING_CODE_PATTERN.test(code)) throw notFound("Colis");
  const [row] = await db
    .select({ s: shipments, originId: routes.originCityId, destinationId: routes.destinationCityId })
    .from(shipments)
    .innerJoin(routes, eq(routes.id, shipments.routeId))
    .where(eq(shipments.trackingCode, code));
  if (!row) throw notFound("Colis");
  const names = await cityNames(db);
  const events = await db
    .select({ toStatus: shipmentEvents.toStatus, occurredAt: shipmentEvents.occurredAt })
    .from(shipmentEvents)
    .where(eq(shipmentEvents.shipmentId, row.s.id))
    .orderBy(asc(shipmentEvents.id));
  return {
    trackingCode: row.s.trackingCode,
    status: row.s.status,
    statusLabel: STATUS_LABELS_FR[row.s.status],
    origin: names.get(row.originId)?.name ?? row.originId,
    destination: names.get(row.destinationId)?.name ?? row.destinationId,
    updatedAt: row.s.statusChangedAt,
    events: events.map((e) => ({ status: e.toStatus, label: STATUS_LABELS_FR[e.toStatus], occurredAt: e.occurredAt })),
  };
}

// ───────────────────────── Transitions

/**
 * Applique une transition autorisée par la table du workflow. Le verrou sur la ligne du colis
 * sérialise les changements concurrents ; l'annulation libère la capacité (ordre des verrous :
 * demande → offre → réservation → colis).
 */
export async function transitionShipment(db: Db, actor: Actor, shipmentId: string, input: TransitionInput, now = new Date()) {
  const to = input.to;
  await db.transaction(async (tx) => {
    const [preview] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!preview) throw notFound("Colis");
    const role = resolveRole(actor, preview);
    if (!role) throw notFound("Colis");

    if (to === "CANCELLED") {
      await tx.select({ id: shipmentRequests.id }).from(shipmentRequests).where(eq(shipmentRequests.id, preview.requestId)).for("update");
      await tx.select({ id: capacityOffers.id }).from(capacityOffers).where(eq(capacityOffers.id, preview.offerId)).for("update");
      await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, preview.bookingId)).for("update");
    }
    const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!shipment) throw notFound("Colis");
    const from = shipment.status;

    if (!isKnownTransition(from, to)) {
      throw conflict("invalid_transition", `Transition ${from} → ${to} impossible`, { from, to });
    }
    if (!canTransition(from, to, role)) {
      throw forbidden("transition_forbidden", `Le rôle « ${role} » ne peut pas passer de ${from} à ${to}`);
    }
    if (to === "DELIVERED" && role === "provider") {
      throw invalid("delivery_code_required", "La remise se confirme avec le code du destinataire");
    }
    const note = input.note?.trim() || null;
    if (NOTE_REQUIRED_FOR.has(to) && !note) throw invalid("note_required", "Une justification est requise pour ce changement de statut");

    await tx.update(shipments).set({ status: to, statusChangedAt: now }).where(eq(shipments.id, shipmentId));
    await tx.insert(shipmentEvents).values({
      shipmentId,
      fromStatus: from,
      toStatus: to,
      actorUserId: actor.id,
      actorRole: role,
      note,
      proofs: input.proofs,
      occurredAt: now,
    });

    if (to === "CANCELLED") await releaseCapacity(tx, shipment);
    if (role === "operator" || to === "CANCELLED" || to === "DAMAGED" || to === "LOST" || to === "DISPUTED") {
      await audit(tx, {
        actorUserId: actor.id,
        action: "shipment.transition",
        entityType: "shipment",
        entityId: shipmentId,
        data: { from, to, role },
      });
    }
  });
}

async function releaseCapacity(tx: Tx, shipment: ShipmentRow): Promise<void> {
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, shipment.bookingId));
  const [offer] = await tx.select().from(capacityOffers).where(eq(capacityOffers.id, shipment.offerId));
  if (booking?.status === "accepted" && offer) {
    await tx
      .update(capacityOffers)
      .set({
        reservedWeightG: Math.max(0, offer.reservedWeightG - booking.weightG),
        reservedVolumeL: Math.max(0, offer.reservedVolumeL - (booking.volumeL ?? 0)),
      })
      .where(eq(capacityOffers.id, offer.id));
    await tx.update(bookings).set({ status: "cancelled", statusReason: "shipment_cancelled" }).where(eq(bookings.id, booking.id));
  }
  // La demande redevient ouverte : l'expéditeur peut rechercher une autre offre.
  await tx
    .update(shipmentRequests)
    .set({ status: "open" })
    .where(and(eq(shipmentRequests.id, shipment.requestId), eq(shipmentRequests.status, "booked")));
}

// ───────────────────────── Code de remise

/**
 * L'EXPÉDITEUR génère (ou régénère) le code à communiquer au destinataire. Le code en clair n'est
 * renvoyé qu'ici, une seule fois : le transporteur ne le voit jamais, il doit le recevoir du destinataire.
 * Régénérer invalide l'ancien code, remet les tentatives à zéro (limité à 5 générations par colis).
 */
export async function generateShipmentDeliveryCode(
  db: Db,
  actor: Actor,
  shipmentId: string,
  now = new Date(),
  pepper = getDeliveryCodePepper(),
): Promise<{ code: string; expiresAt: Date; generation: number }> {
  return db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!shipment) throw notFound("Colis");
    if (shipment.senderUserId !== actor.id) throw resolveRole(actor, shipment) ? forbidden() : notFound("Colis");
    if (!CODE_ACTIVE_STATUSES.has(shipment.status) || shipment.deliveryCodeConsumedAt) {
      throw conflict("delivery_code_not_available", "Un code ne peut plus être généré pour ce colis");
    }
    if (shipment.deliveryCodeGeneration >= MAX_CODE_GENERATIONS) {
      throw conflict("delivery_code_generation_limit", "Nombre maximal de codes atteint : contactez le support");
    }
    const code = generateDeliveryCode();
    const expiresAt = deliveryCodeExpiry(now);
    const generation = shipment.deliveryCodeGeneration + 1;
    await tx
      .update(shipments)
      .set({
        deliveryCodeHash: hashDeliveryCode(code, shipment.id, pepper),
        deliveryCodeGeneration: generation,
        deliveryCodeExpiresAt: expiresAt,
        deliveryCodeAttempts: 0,
        deliveryCodeLockedAt: null,
      })
      .where(eq(shipments.id, shipmentId));
    await audit(tx, { actorUserId: actor.id, action: "delivery_code.generated", entityType: "shipment", entityId: shipmentId, data: { generation } });
    return { code, expiresAt, generation };
  });
}

/**
 * Le PRESTATAIRE saisit le code donné par le destinataire. Usage unique, 5 tentatives maximum,
 * expiration. Les tentatives ratées sont enregistrées (la transaction est validée) avant de signaler l'erreur.
 */
export async function confirmDelivery(
  db: Db,
  actor: Actor,
  shipmentId: string,
  code: string,
  now = new Date(),
  pepper = getDeliveryCodePepper(),
): Promise<void> {
  const outcome = await db.transaction(async (tx): Promise<{ error: AppError } | { ok: true }> => {
    const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!shipment) throw notFound("Colis");
    const role = resolveRole(actor, shipment);
    if (!role) throw notFound("Colis");
    if (role !== "provider") throw forbidden("only_provider_confirms", "Seul le transporteur confirme la remise avec le code du destinataire");
    if (!DELIVERABLE_STATUSES.has(shipment.status)) {
      throw conflict("not_deliverable", "Le colis doit être arrivé à destination avant la remise", { status: shipment.status });
    }
    if (!shipment.deliveryCodeHash || !shipment.deliveryCodeExpiresAt) {
      return { error: conflict("delivery_code_not_generated", "L'expéditeur n'a pas encore généré le code de remise") };
    }
    const state = checkCodeState(
      {
        attempts: shipment.deliveryCodeAttempts,
        lockedAt: shipment.deliveryCodeLockedAt,
        expiresAt: shipment.deliveryCodeExpiresAt,
        consumedAt: shipment.deliveryCodeConsumedAt,
      },
      now,
    );
    if (state === "consumed") return { error: conflict("delivery_code_used", "Ce code a déjà été utilisé") };
    if (state === "locked") return { error: locked("delivery_code_locked", "Trop de tentatives : l'expéditeur doit générer un nouveau code") };
    if (state === "expired") return { error: conflict("delivery_code_expired", "Code expiré : l'expéditeur doit générer un nouveau code") };

    if (!verifyDeliveryCode(code, shipment.id, pepper, shipment.deliveryCodeHash)) {
      const attempts = shipment.deliveryCodeAttempts + 1;
      const nowLocked = attempts >= HANDOVER_CONFIG.maxAttempts;
      await tx
        .update(shipments)
        .set({ deliveryCodeAttempts: attempts, deliveryCodeLockedAt: nowLocked ? now : null })
        .where(eq(shipments.id, shipmentId));
      await audit(tx, {
        actorUserId: actor.id,
        action: "delivery_code.failed_attempt",
        entityType: "shipment",
        entityId: shipmentId,
        data: { attempts, locked: nowLocked },
      });
      return {
        error: nowLocked
          ? locked("delivery_code_locked", "Trop de tentatives : l'expéditeur doit générer un nouveau code")
          : invalid("delivery_code_invalid", "Code incorrect", { attemptsLeft: HANDOVER_CONFIG.maxAttempts - attempts }),
      };
    }

    const from = shipment.status;
    await tx
      .update(shipments)
      .set({ status: "DELIVERED", statusChangedAt: now, deliveryCodeConsumedAt: now })
      .where(eq(shipments.id, shipmentId));
    await tx.insert(shipmentEvents).values({
      shipmentId,
      fromStatus: from,
      toStatus: "DELIVERED",
      actorUserId: actor.id,
      actorRole: "provider",
      context: { via: "delivery_code", codeGeneration: shipment.deliveryCodeGeneration },
      occurredAt: now,
    });
    return { ok: true };
  });
  if ("error" in outcome) throw outcome.error;
}
