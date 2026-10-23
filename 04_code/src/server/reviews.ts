import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { REVIEW_WINDOW_DAYS } from "@/config/app";
import { schema, type Db, type DbOrTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { resolveRole, type Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, notFound } from "./errors";

const { reviews, shipments, users, travelerProfiles } = schema;

export interface RatingSummary {
  count: number;
  /** Moyenne sur 5 arrondie à une décimale, `null` sans avis. */
  average: number | null;
  /** Somme brute des notes : utilisée par le classement (moyenne bayésienne). */
  sum: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Notes reçues par chaque utilisateur dans un rôle donné. Un utilisateur noté « en tant que transporteur »
 * reçoit des avis d'expéditeurs (`author_role = sender`) ; « en tant qu'expéditeur », des avis de transporteurs.
 */
export async function ratingsFor(db: DbOrTx, userIds: string[], subjectRole: "provider" | "sender"): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: reviews.subjectUserId,
      count: sql<number>`count(*)`.mapWith(Number),
      sum: sql<number>`sum(${reviews.rating})`.mapWith(Number),
    })
    .from(reviews)
    .where(and(inArray(reviews.subjectUserId, [...new Set(userIds)]), eq(reviews.authorRole, subjectRole === "provider" ? "sender" : "provider")))
    .groupBy(reviews.subjectUserId);
  for (const r of rows) out.set(r.userId, { count: r.count, sum: r.sum, average: round1(r.sum / r.count) });
  return out;
}

export const NO_RATING: RatingSummary = { count: 0, sum: 0, average: null };

export interface ReviewView {
  rating: number;
  comment: string | null;
  authorName: string;
  authorRole: "sender" | "provider";
  createdAt: Date;
}

/**
 * Dépose un avis sur l'autre partie. Conditions : colis `DELIVERED`, auteur = expéditeur ou transporteur
 * (pas un opérateur), un seul avis par auteur et par colis, dans les 30 jours qui suivent la livraison.
 */
export async function createReview(
  db: Db,
  actor: Actor,
  shipmentId: string,
  input: { rating: number; comment?: string | null },
  now = new Date(),
): Promise<void> {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment) throw notFound("Colis");
  const role = resolveRole(actor, shipment);
  if (!role) throw notFound("Colis");
  if (role !== "sender" && role !== "provider") throw forbidden("only_parties_review", "Seuls l'expéditeur et le transporteur peuvent déposer un avis");
  if (shipment.status !== "DELIVERED") throw conflict("review_not_available", "Un avis se dépose une fois la remise confirmée");
  const windowEnd = new Date(shipment.statusChangedAt.getTime() + REVIEW_WINDOW_DAYS * 24 * 3600 * 1000);
  if (now > windowEnd) throw conflict("review_window_closed", `Le délai de ${REVIEW_WINDOW_DAYS} jours pour déposer un avis est dépassé`);

  const subjectUserId = role === "sender" ? shipment.providerUserId : shipment.senderUserId;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(reviews).values({
        shipmentId,
        authorUserId: actor.id,
        subjectUserId,
        authorRole: role,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        createdAt: now,
      });
      await audit(tx, { actorUserId: actor.id, action: "review.created", entityType: "shipment", entityId: shipmentId, data: { rating: input.rating, role } });
    });
  } catch (err) {
    if (isUniqueViolation(err, "reviews_one_per_author_per_shipment_key")) throw conflict("already_reviewed", "Vous avez déjà déposé un avis pour ce colis");
    throw err;
  }
}

export interface ShipmentReviews {
  canReview: boolean;
  /** Fin du délai de dépôt, le colis étant livré. */
  windowEndsAt: Date | null;
  mine: ReviewView | null;
  theirs: ReviewView | null;
}

/** Avis d'un colis, vus par une partie : le sien et celui de l'autre partie. */
export async function getShipmentReviews(db: Db, actor: Actor, shipmentId: string, now = new Date()): Promise<ShipmentReviews> {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment) throw notFound("Colis");
  const role = resolveRole(actor, shipment);
  if (!role) throw notFound("Colis");
  const rows = await db
    .select({ r: reviews, authorName: users.displayName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.authorUserId))
    .where(eq(reviews.shipmentId, shipmentId));
  const view = (row: (typeof rows)[number]): ReviewView => ({
    rating: row.r.rating,
    comment: row.r.comment,
    authorName: row.authorName,
    authorRole: row.r.authorRole as "sender" | "provider",
    createdAt: row.r.createdAt,
  });
  const mineRow = rows.find((r) => r.r.authorUserId === actor.id);
  const theirRow = rows.find((r) => r.r.authorUserId !== actor.id);
  const windowEndsAt = shipment.status === "DELIVERED" ? new Date(shipment.statusChangedAt.getTime() + REVIEW_WINDOW_DAYS * 24 * 3600 * 1000) : null;
  return {
    canReview: (role === "sender" || role === "provider") && shipment.status === "DELIVERED" && !mineRow && windowEndsAt !== null && now <= windowEndsAt,
    windowEndsAt,
    mine: mineRow ? view(mineRow) : null,
    theirs: theirRow ? view(theirRow) : null,
  };
}

export interface Reputation {
  user: { id: string; displayName: string; identityStatus: string | null };
  asProvider: { ratings: RatingSummary; delivered: number; incidents: number };
  asSender: { ratings: RatingSummary; delivered: number };
  recent: ReviewView[];
}

/** Réputation publique : agrégats et derniers avis. Aucune donnée de contact ni de colis. */
export async function getReputation(db: Db, userId: string, recentLimit = 10): Promise<Reputation> {
  const [row] = await db
    .select({ id: users.id, displayName: users.displayName, status: users.status, identityStatus: travelerProfiles.identityStatus })
    .from(users)
    .leftJoin(travelerProfiles, eq(travelerProfiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row || row.status !== "active") throw notFound("Utilisateur");

  const [asProviderRatings, asSenderRatings] = await Promise.all([ratingsFor(db, [userId], "provider"), ratingsFor(db, [userId], "sender")]);
  const [provided] = await db
    .select({
      delivered: sql<number>`count(*) filter (where ${shipments.status} = 'DELIVERED')`.mapWith(Number),
      incidents: sql<number>`count(*) filter (where ${shipments.status} in ('LOST','DAMAGED','DISPUTED'))`.mapWith(Number),
    })
    .from(shipments)
    .where(eq(shipments.providerUserId, userId));
  const [sent] = await db
    .select({ delivered: sql<number>`count(*) filter (where ${shipments.status} = 'DELIVERED')`.mapWith(Number) })
    .from(shipments)
    .where(eq(shipments.senderUserId, userId));

  const recentRows = await db
    .select({ r: reviews, authorName: users.displayName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.authorUserId))
    .where(eq(reviews.subjectUserId, userId))
    .orderBy(desc(reviews.createdAt))
    .limit(recentLimit);

  return {
    user: { id: row.id, displayName: row.displayName, identityStatus: row.identityStatus ?? null },
    asProvider: { ratings: asProviderRatings.get(userId) ?? NO_RATING, delivered: provided?.delivered ?? 0, incidents: provided?.incidents ?? 0 },
    asSender: { ratings: asSenderRatings.get(userId) ?? NO_RATING, delivered: sent?.delivered ?? 0 },
    recent: recentRows.map(({ r, authorName }) => ({
      rating: r.rating,
      comment: r.comment,
      authorName,
      authorRole: r.authorRole as "sender" | "provider",
      createdAt: r.createdAt,
    })),
  };
}
