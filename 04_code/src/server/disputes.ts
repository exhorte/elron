import { asc, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db/client";
import type { DisputeOutcome, DisputeReason } from "@/domain/disputes";
import type { ActorRole, ShipmentStatus } from "@/domain/workflow";
import { isOperator, resolveRole, type Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, notFound } from "./errors";
import { resolveProofRefs, type ProofSnapshot } from "./proofs";
import { applyLockedTransition, lockShipmentForTransition } from "./shipments";

export type { DisputeOutcome, DisputeReason };

const { disputes, disputeMessages, shipments, users } = schema;


/** Statut cible du colis pour chaque issue ; `resume` = retour à l'état d'avant le litige. */
const OUTCOME_TARGET: Record<Exclude<DisputeOutcome, "resume">, ShipmentStatus> = {
  delivered: "DELIVERED",
  returned: "RETURNED",
  lost: "LOST",
  damaged: "DAMAGED",
  cancelled: "CANCELLED",
};

export interface DisputeMessageView {
  id: number;
  authorName: string;
  authorRole: ActorRole;
  kind: string;
  body: string;
  proofs: ProofSnapshot[];
  createdAt: Date;
}

export interface DisputeView {
  id: string;
  shipmentId: string;
  trackingCode?: string;
  status: "open" | "resolved";
  reasonCode: string;
  description: string;
  openerRole: ActorRole;
  openerName: string;
  statusBefore: ShipmentStatus;
  resolutionOutcome: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  messages: DisputeMessageView[];
}

type DisputeRow = typeof disputes.$inferSelect;

async function buildView(db: Db, row: DisputeRow, trackingCode?: string): Promise<DisputeView> {
  const [opener] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, row.openedBy));
  const msgs = await db
    .select({ m: disputeMessages, name: users.displayName })
    .from(disputeMessages)
    .innerJoin(users, eq(users.id, disputeMessages.authorUserId))
    .where(eq(disputeMessages.disputeId, row.id))
    .orderBy(asc(disputeMessages.id));
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    trackingCode,
    status: row.status,
    reasonCode: row.reasonCode,
    description: row.description,
    openerRole: row.openerRole,
    openerName: opener?.name ?? "—",
    statusBefore: row.statusBefore,
    resolutionOutcome: row.resolutionOutcome,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    messages: msgs.map(({ m, name }) => ({
      id: m.id,
      authorName: name,
      authorRole: m.authorRole,
      kind: m.kind,
      body: m.body,
      proofs: m.proofs as ProofSnapshot[],
      createdAt: m.createdAt,
    })),
  };
}

/**
 * Ouvre un litige : fait passer le colis à `DISPUTED` (table des transitions et rôles) et crée le litige et son
 * premier message dans la même transaction. Les parties peuvent contester depuis les états prévus par le
 * workflow ; un colis annulé ou retourné ne peut plus l'être.
 */
export async function openDispute(
  db: Db,
  actor: Actor,
  shipmentId: string,
  input: { reasonCode: DisputeReason; description: string; proofs: Array<{ fileId: string; description?: string | null }> },
  now = new Date(),
): Promise<DisputeView> {
  const created = await db.transaction(async (tx) => {
    const [preview] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!preview) throw notFound("Colis");
    const role = resolveRole(actor, preview);
    if (!role) throw notFound("Colis");

    const shipment = await lockShipmentForTransition(tx, shipmentId, false);
    if (shipment.status === "DISPUTED") throw conflict("dispute_open", "Un litige est déjà ouvert pour ce colis");
    const proofs = await resolveProofRefs(tx, shipmentId, input.proofs);
    await applyLockedTransition(
      tx,
      shipment,
      actor,
      { to: "DISPUTED", role, note: input.description, proofs, context: { reasonCode: input.reasonCode } },
      now,
    );

    const [row] = await tx
      .insert(disputes)
      .values({
        shipmentId,
        openedBy: actor.id,
        openerRole: role,
        reasonCode: input.reasonCode,
        description: input.description,
        statusBefore: shipment.status,
        createdAt: now,
      })
      .returning();
    await tx.insert(disputeMessages).values({
      disputeId: row!.id,
      authorUserId: actor.id,
      authorRole: role,
      body: input.description,
      proofs,
      kind: "opening",
      createdAt: now,
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: "dispute.opened",
      entityType: "dispute",
      entityId: row!.id,
      data: { shipmentId, reasonCode: input.reasonCode, role },
    });
    return row!;
  });
  return buildView(db, created);
}

/** Ajoute un message (et des preuves) à un litige ouvert : parties du colis et opérateurs uniquement. */
export async function postDisputeMessage(
  db: Db,
  actor: Actor,
  disputeId: string,
  input: { body: string; proofs: Array<{ fileId: string; description?: string | null }> },
  now = new Date(),
): Promise<DisputeView> {
  await db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for("update");
    if (!dispute) throw notFound("Litige");
    const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, dispute.shipmentId));
    const role = shipment ? resolveRole(actor, shipment) : null;
    if (!role) throw notFound("Litige");
    if (dispute.status !== "open") throw conflict("dispute_closed", "Ce litige est clos");
    const proofs = await resolveProofRefs(tx, dispute.shipmentId, input.proofs);
    await tx.insert(disputeMessages).values({ disputeId, authorUserId: actor.id, authorRole: role, body: input.body, proofs, createdAt: now });
  });
  const [row] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  return buildView(db, row!);
}

/** Litiges d'un colis (ouverts et clos), du plus récent au plus ancien. Parties et opérateurs ; 404 pour les tiers. */
export async function listShipmentDisputes(db: Db, actor: Actor, shipmentId: string): Promise<DisputeView[]> {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment || !resolveRole(actor, shipment)) throw notFound("Colis");
  const rows = await db.select().from(disputes).where(eq(disputes.shipmentId, shipmentId)).orderBy(desc(disputes.createdAt));
  return Promise.all(rows.map((r) => buildView(db, r, shipment.trackingCode)));
}

export async function listOpenDisputes(db: Db, actor: Actor): Promise<DisputeView[]> {
  if (!isOperator(actor)) throw forbidden("operator_required", "Réservé aux opérateurs de la plateforme");
  const rows = await db
    .select({ d: disputes, trackingCode: shipments.trackingCode })
    .from(disputes)
    .innerJoin(shipments, eq(shipments.id, disputes.shipmentId))
    .where(eq(disputes.status, "open"))
    .orderBy(asc(disputes.createdAt));
  return Promise.all(rows.map((r) => buildView(db, r.d, r.trackingCode)));
}

/**
 * Résolution par un opérateur (jamais partie au colis). Applique l'issue au colis (transition contrôlée,
 * libération de capacité si annulation), clôt le litige et consigne la décision dans le fil et l'audit.
 */
export async function resolveDispute(
  db: Db,
  actor: Actor,
  disputeId: string,
  input: { outcome: DisputeOutcome; note: string },
  now = new Date(),
): Promise<DisputeView> {
  if (!isOperator(actor)) throw forbidden("operator_required", "Réservé aux opérateurs de la plateforme");
  const resolved = await db.transaction(async (tx) => {
    const [preview] = await tx.select().from(disputes).where(eq(disputes.id, disputeId));
    if (!preview) throw notFound("Litige");
    const shipmentId = preview.shipmentId;
    const [pre] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (pre!.senderUserId === actor.id || pre!.providerUserId === actor.id) {
      throw forbidden("party_cannot_resolve", "Une partie au colis ne peut pas résoudre son propre litige");
    }

    // Ordre des verrous : demande → offre → réservation → colis, puis le litige.
    const shipment = await lockShipmentForTransition(tx, shipmentId, input.outcome === "cancelled");
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for("update");
    if (!dispute || dispute.status !== "open") throw conflict("dispute_closed", "Ce litige est déjà clos");
    if (shipment.status !== "DISPUTED") throw conflict("inconsistent_state", "Le colis n'est pas en litige");

    const to = input.outcome === "resume" ? dispute.statusBefore : OUTCOME_TARGET[input.outcome];
    await applyLockedTransition(
      tx,
      shipment,
      actor,
      { to, role: "operator", note: input.note, proofs: [], context: { disputeId, outcome: input.outcome } },
      now,
    );
    const [row] = await tx
      .update(disputes)
      .set({ status: "resolved", resolutionOutcome: input.outcome, resolutionNote: input.note, resolvedBy: actor.id, resolvedAt: now })
      .where(eq(disputes.id, disputeId))
      .returning();
    await tx.insert(disputeMessages).values({
      disputeId,
      authorUserId: actor.id,
      authorRole: "operator",
      body: input.note,
      kind: "resolution",
      createdAt: now,
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: "dispute.resolved",
      entityType: "dispute",
      entityId: disputeId,
      data: { shipmentId, outcome: input.outcome, to },
    });
    return row!;
  });
  return buildView(db, resolved);
}
