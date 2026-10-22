import { desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db/client";
import { STATUS_LABELS_FR } from "@/domain/workflow";
import { isOperator, type Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, notFound } from "./errors";
import type { TravelerProfileInput } from "./validation";

const { users, travelerProfiles, sessions, shipments, routes } = schema;

function requireOperator(actor: Actor): void {
  if (!isOperator(actor)) throw forbidden("operator_required", "Réservé aux opérateurs de la plateforme");
}

// ───────────────────────── Profil voyageur et statut d'identité (déclaré ≠ vérifié ≠ décision opérateur)

export async function getTravelerProfile(db: Db, userId: string) {
  const [row] = await db.select().from(travelerProfiles).where(eq(travelerProfiles.userId, userId));
  return row ?? null;
}

/**
 * Crée/met à jour le profil voyageur. Déclarer une identité (nom + type de pièce, aucun numéro, aucun
 * fichier) place le statut à `declared` : cela ne vaut PAS vérification. Seul un opérateur peut
 * passer à `verified` (reviewIdentity).
 */
export async function upsertTravelerProfile(db: Db, actor: Actor, input: TravelerProfileInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(travelerProfiles).where(eq(travelerProfiles.userId, actor.id)).for("update");
    const declaring = input.declaredLegalName && input.declaredIdKind;

    if (!existing) {
      const [created] = await tx
        .insert(travelerProfiles)
        .values({
          userId: actor.id,
          bio: input.bio ?? null,
          ...(declaring
            ? {
                declaredLegalName: input.declaredLegalName,
                declaredIdKind: input.declaredIdKind,
                identityStatus: "declared" as const,
                identityDeclaredAt: now,
              }
            : {}),
        })
        .returning();
      return created!;
    }

    const patch: Partial<typeof travelerProfiles.$inferInsert> = {};
    if (input.bio !== undefined) patch.bio = input.bio ?? null;
    if (declaring) {
      const changesVerifiedName = existing.identityStatus === "verified" && existing.declaredLegalName !== input.declaredLegalName;
      if (changesVerifiedName) throw conflict("identity_locked", "Identité déjà vérifiée : contactez un opérateur pour la modifier");
      if (existing.identityStatus !== "verified") {
        patch.declaredLegalName = input.declaredLegalName;
        patch.declaredIdKind = input.declaredIdKind;
        patch.identityStatus = "declared";
        patch.identityDeclaredAt = now;
        patch.identityReviewedBy = null;
        patch.identityReviewedAt = null;
        patch.identityReviewNote = null;
      }
    }
    if (Object.keys(patch).length === 0) return existing;
    const [updated] = await tx.update(travelerProfiles).set(patch).where(eq(travelerProfiles.userId, actor.id)).returning();
    return updated!;
  });
}

export async function listPendingIdentityReviews(db: Db, actor: Actor) {
  requireOperator(actor);
  return db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      declaredLegalName: travelerProfiles.declaredLegalName,
      declaredIdKind: travelerProfiles.declaredIdKind,
      declaredAt: travelerProfiles.identityDeclaredAt,
    })
    .from(travelerProfiles)
    .innerJoin(users, eq(users.id, travelerProfiles.userId))
    .where(eq(travelerProfiles.identityStatus, "declared"));
}

/** Décision d'opérateur : la vérification elle-même se fait hors plateforme ; ici on n'en enregistre que le résultat. */
export async function reviewIdentity(
  db: Db,
  actor: Actor,
  targetUserId: string,
  decision: "verified" | "rejected",
  note: string | null | undefined,
  now = new Date(),
) {
  requireOperator(actor);
  if (actor.id === targetUserId) throw forbidden("self_review", "Vous ne pouvez pas valider votre propre identité");
  await db.transaction(async (tx) => {
    const [profile] = await tx.select().from(travelerProfiles).where(eq(travelerProfiles.userId, targetUserId)).for("update");
    if (!profile) throw notFound("Profil voyageur");
    if (profile.identityStatus !== "declared") throw conflict("identity_not_declared", "Aucune identité déclarée en attente de revue");
    await tx
      .update(travelerProfiles)
      .set({ identityStatus: decision, identityReviewedBy: actor.id, identityReviewedAt: now, identityReviewNote: note ?? null })
      .where(eq(travelerProfiles.userId, targetUserId));
    await audit(tx, { actorUserId: actor.id, action: "identity.reviewed", entityType: "user", entityId: targetUserId, data: { decision } });
  });
}

// ───────────────────────── Comptes et supervision

export async function setUserStatus(db: Db, actor: Actor, targetUserId: string, status: "active" | "suspended", reason: string) {
  if (actor.platformRole !== "admin") throw forbidden("admin_required", "Réservé aux administrateurs");
  if (actor.id === targetUserId) throw forbidden("self_suspend", "Vous ne pouvez pas modifier votre propre statut");
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).for("update");
    if (!target) throw notFound("Utilisateur");
    await tx.update(users).set({ status }).where(eq(users.id, targetUserId));
    if (status === "suspended") await tx.delete(sessions).where(eq(sessions.userId, targetUserId));
    await audit(tx, { actorUserId: actor.id, action: "user.status_changed", entityType: "user", entityId: targetUserId, data: { status, reason } });
  });
}

export async function listAllShipments(db: Db, actor: Actor, limit = 100) {
  requireOperator(actor);
  const rows = await db
    .select({ s: shipments, originId: routes.originCityId, destinationId: routes.destinationCityId })
    .from(shipments)
    .innerJoin(routes, eq(routes.id, shipments.routeId))
    .orderBy(desc(shipments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(({ s, originId, destinationId }) => ({
    id: s.id,
    trackingCode: s.trackingCode,
    status: s.status,
    statusLabel: STATUS_LABELS_FR[s.status],
    weightG: s.weightG,
    originId,
    destinationId,
    statusChangedAt: s.statusChangedAt,
  }));
}
