import { and, desc, eq } from "drizzle-orm";
import { categoryPolicy } from "@/config/goods-policy";
import { schema, type Db } from "@/db/client";
import type { CurrencyCode } from "@/domain/money";
import { isOperator, type Actor } from "./actor";
import { audit } from "./audit";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { requireEnabledRoute } from "./geo";
import type { RequestCreateInput } from "./validation";

const { shipmentRequests, bookings } = schema;

export type RequestRow = typeof shipmentRequests.$inferSelect;

export async function createRequest(db: Db, actor: Actor, input: RequestCreateInput, now = new Date()): Promise<RequestRow> {
  const route = await requireEnabledRoute(db, input.originCityId, input.destinationCityId);
  if (categoryPolicy(input.category) === "prohibited") {
    throw invalid("category_prohibited", "Cette catégorie de marchandise est interdite par la politique de la plateforme", {
      category: input.category,
    });
  }
  if (input.latestDepartureAt && input.latestDepartureAt <= now) throw invalid("window_in_past", "La fenêtre de départ est déjà passée");
  if (input.neededBy && input.neededBy <= now) throw invalid("deadline_in_past", "L'échéance est déjà passée");

  const hasDims = input.lengthCm != null && input.widthCm != null && input.heightCm != null;
  const volumeL = hasDims ? Math.max(1, Math.ceil((input.lengthCm! * input.widthCm! * input.heightCm!) / 1000)) : null;
  const items = input.items.length > 0 ? input.items : [{ description: input.description.slice(0, 200), quantity: 1, declaredValueMinor: null }];

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(shipmentRequests)
      .values({
        senderUserId: actor.id,
        routeId: route.id,
        weightG: input.weightG,
        lengthCm: input.lengthCm ?? null,
        widthCm: input.widthCm ?? null,
        heightCm: input.heightCm ?? null,
        volumeL,
        category: input.category,
        description: input.description,
        items,
        declaredValueMinor: input.declaredValueMinor ?? null,
        declaredValueCurrency: input.declaredValueCurrency ?? null,
        budgetMaxMinor: input.budgetMaxMinor ?? null,
        budgetCurrency: input.budgetCurrency ?? null,
        budgetIsStrict: input.budgetIsStrict,
        earliestDepartureAt: input.earliestDepartureAt ?? null,
        latestDepartureAt: input.latestDepartureAt ?? null,
        neededBy: input.neededBy ?? null,
        deadlineIsStrict: input.deadlineIsStrict,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        isDemo: actor.isDemo,
      })
      .returning();
    await audit(tx, { actorUserId: actor.id, action: "request.created", entityType: "shipment_request", entityId: row!.id });
    return row!;
  });
}

export interface RequestView {
  id: string;
  routeId: string;
  status: RequestRow["status"];
  weightG: number;
  volumeL: number | null;
  category: string;
  description: string;
  budgetMaxMinor: number | null;
  budgetCurrency: CurrencyCode | null;
  budgetIsStrict: boolean;
  earliestDepartureAt: Date | null;
  latestDepartureAt: Date | null;
  neededBy: Date | null;
  deadlineIsStrict: boolean;
  receiverName: string;
  isDemo: boolean;
  createdAt: Date;
}

export function toRequestView(row: RequestRow): RequestView {
  return {
    id: row.id,
    routeId: row.routeId,
    status: row.status,
    weightG: row.weightG,
    volumeL: row.volumeL,
    category: row.category,
    description: row.description,
    budgetMaxMinor: row.budgetMaxMinor,
    budgetCurrency: row.budgetCurrency as CurrencyCode | null,
    budgetIsStrict: row.budgetIsStrict,
    earliestDepartureAt: row.earliestDepartureAt,
    latestDepartureAt: row.latestDepartureAt,
    neededBy: row.neededBy,
    deadlineIsStrict: row.deadlineIsStrict,
    receiverName: row.receiverName,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
  };
}

export async function listRequestsBySender(db: Db, actor: Actor): Promise<RequestView[]> {
  const rows = await db.select().from(shipmentRequests).where(eq(shipmentRequests.senderUserId, actor.id)).orderBy(desc(shipmentRequests.createdAt));
  return rows.map(toRequestView);
}

/** Lecture d'une demande : son auteur ou un opérateur uniquement. */
export async function getRequestForActor(db: Db, actor: Actor, requestId: string): Promise<RequestRow> {
  const [row] = await db.select().from(shipmentRequests).where(eq(shipmentRequests.id, requestId)).limit(1);
  if (!row) throw notFound("Demande");
  if (row.senderUserId !== actor.id && !isOperator(actor)) throw forbidden();
  return row;
}

export async function cancelRequest(db: Db, actor: Actor, requestId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(shipmentRequests).where(eq(shipmentRequests.id, requestId)).for("update");
    if (!row) throw notFound("Demande");
    if (row.senderUserId !== actor.id) throw forbidden();
    if (row.status !== "open") {
      throw conflict("request_not_open", row.status === "booked" ? "Une réservation est acceptée : annulez le colis" : "Demande déjà fermée");
    }
    await tx
      .update(bookings)
      .set({ status: "cancelled", statusReason: "request_cancelled", decidedAt: now, decidedBy: actor.id })
      .where(and(eq(bookings.requestId, requestId), eq(bookings.status, "requested")));
    await tx.update(shipmentRequests).set({ status: "cancelled" }).where(eq(shipmentRequests.id, requestId));
    await audit(tx, { actorUserId: actor.id, action: "request.cancelled", entityType: "shipment_request", entityId: requestId });
  });
}
