import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { listOpenDisputes, listShipmentDisputes, openDispute, postDisputeMessage, resolveDispute, type DisputeOutcome } from "@/server/disputes";
import { uploadProof } from "@/server/proofs";
import { confirmDelivery, generateShipmentDeliveryCode, getShipmentView, transitionShipment } from "@/server/shipments";
import type { TransitionInput } from "@/server/validation";
import { requestBooking } from "@/server/bookings";
import { db, dbError, errorCode, jpegBytes, makeAcceptedShipment, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

type Ctx = Awaited<ReturnType<typeof makeAcceptedShipment>>;
const move = (ctx: Ctx, actor: Ctx["provider"], to: TransitionInput["to"], note?: string) =>
  transitionShipment(db(), actor, ctx.shipmentId, { to, note: note ?? null, proofs: [] });
const dispute = (ctx: Ctx, actor: Ctx["sender"], description = "Le colis ne correspond pas à la description annoncée", proofs: Array<{ fileId: string }> = []) =>
  openDispute(db(), actor, ctx.shipmentId, { reasonCode: "content_mismatch", description, proofs });
const resolve = (id: string, actor: Ctx["sender"], outcome: DisputeOutcome, note = "Décision après examen des échanges") =>
  resolveDispute(db(), actor, id, { outcome, note });

async function toArrived(ctx: Ctx) {
  await move(ctx, ctx.provider, "HANDED_OVER");
  await move(ctx, ctx.provider, "IN_TRANSIT");
  await move(ctx, ctx.provider, "ARRIVED");
}

describe("ouverture d'un litige", () => {
  it("fait passer le colis à DISPUTED, crée le litige, son premier message, l'événement et l'audit", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const d = await dispute(ctx, ctx.sender);
    expect(d).toMatchObject({ status: "open", reasonCode: "content_mismatch", openerRole: "sender", statusBefore: "ARRIVED", shipmentId: ctx.shipmentId });
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]).toMatchObject({ kind: "opening", authorRole: "sender", body: "Le colis ne correspond pas à la description annoncée" });

    const view = await getShipmentView(db(), ctx.provider, ctx.shipmentId);
    expect(view.status).toBe("DISPUTED");
    expect(view.openDispute).toMatchObject({ id: d.id, reasonCode: "content_mismatch", openerRole: "sender" });
    expect(view.allowedTransitions).toEqual([]);
    expect(view.canOpenDispute).toBe(false);
    const event = view.events.at(-1)!;
    expect(event).toMatchObject({ fromStatus: "ARRIVED", toStatus: "DISPUTED", actorRole: "sender" });
    const [raw] = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.toStatus, "DISPUTED"));
    expect(raw!.context).toMatchObject({ reasonCode: "content_mismatch" });
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "dispute.opened"));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data).toMatchObject({ reasonCode: "content_mismatch", role: "sender" });
  });

  it("suit les droits du workflow : le transporteur peut ouvrir en cours de route mais pas contester une remise", async () => {
    const a = await makeAcceptedShipment();
    await move(a, a.provider, "HANDED_OVER");
    await expect(dispute(a, a.provider, "Le destinataire injoignable depuis deux jours")).resolves.toMatchObject({ openerRole: "provider" });

    const b = await makeAcceptedShipment();
    await toArrived(b);
    const { code } = await generateShipmentDeliveryCode(db(), b.sender, b.shipmentId);
    await confirmDelivery(db(), b.provider, b.shipmentId, code);
    expect(await errorCode(dispute(b, b.provider, "Je conteste cette remise confirmée"))).toBe("transition_forbidden");
    await expect(dispute(b, b.sender, "Le contenu était endommagé à la réception")).resolves.toMatchObject({ statusBefore: "DELIVERED" });
  });

  it("autorise un opérateur, refuse un tiers (404) et un colis annulé ou retourné", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(dispute(ctx, await makeUser()))).toBe("not_found");
    const operator = await makeUser({ role: "operator" });
    await expect(dispute(ctx, operator, "Signalement d'office après plainte reçue")).resolves.toMatchObject({ openerRole: "operator" });

    const cancelled = await makeAcceptedShipment();
    await move(cancelled, cancelled.sender, "CANCELLED", "Changement de plan");
    expect(await errorCode(dispute(cancelled, cancelled.sender))).toBe("invalid_transition");
  });

  it("n'accepte qu'un seul litige ouvert, même ouvert simultanément par les deux parties", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.provider, "HANDED_OVER");
    const results = await Promise.allSettled([dispute(ctx, ctx.sender), dispute(ctx, ctx.provider, "Le colis a été refusé à l'arrivée")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toMatch(/dispute_open|invalid_transition/);
    expect(await db().select().from(schema.disputes)).toHaveLength(1);
    expect(await errorCode(dispute(ctx, ctx.sender))).toBe("dispute_open");
  });

  it("joint des preuves du colis au litige, et refuse celles d'un autre colis", async () => {
    const ctx = await makeAcceptedShipment();
    const other = await makeAcceptedShipment();
    const mine = await uploadProof(db(), ctx.sender, ctx.shipmentId, { bytes: jpegBytes(), originalName: "photo.jpg", purpose: "damage" });
    const foreign = await uploadProof(db(), other.sender, other.shipmentId, { bytes: jpegBytes(), originalName: "x.jpg", purpose: "damage" });
    expect(await errorCode(dispute(ctx, ctx.sender, "Colis reçu abîmé, voir photo", [{ fileId: foreign.id }]))).toBe("proof_not_found");
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("ACCEPTED");
    const d = await dispute(ctx, ctx.sender, "Colis reçu abîmé, voir photo", [{ fileId: mine.id }]);
    expect(d.messages[0]!.proofs).toMatchObject([{ fileId: mine.id, sha256: mine.sha256 }]);
  });
});

describe("pendant le litige", () => {
  it("gèle le colis : aucune transition générique, même d'un opérateur, ni confirmation de remise", async () => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    await toArrived(ctx);
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await dispute(ctx, ctx.sender);
    expect(await errorCode(move(ctx, ctx.provider, "OUT_FOR_DELIVERY"))).toBe("dispute_open");
    expect(await errorCode(move(ctx, operator, "RETURNED", "x"))).toBe("dispute_open");
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code))).toBe("not_deliverable");
  });

  it("la base garantit un seul litige ouvert par colis et la cohérence de la résolution", async () => {
    const ctx = await makeAcceptedShipment();
    const d = await dispute(ctx, ctx.sender);
    const [row] = await db().select().from(schema.disputes).where(eq(schema.disputes.id, d.id));
    const { id: _id, ...clone } = row!;
    void _id;
    expect(await dbError(db().insert(schema.disputes).values(clone))).toMatch(/disputes_one_open_per_shipment_key/);
    expect(await dbError(db().update(schema.disputes).set({ status: "resolved" }).where(eq(schema.disputes.id, d.id)))).toMatch(/disputes_resolution_complete/);
    expect(await dbError(db().update(schema.disputes).set({ reasonCode: "inventé" }).where(eq(schema.disputes.id, d.id)))).toMatch(/disputes_reason_known/);
  });

  it("permet aux parties et aux opérateurs d'échanger, dans l'ordre, avec des preuves ; refuse les tiers", async () => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    const d = await dispute(ctx, ctx.sender);
    const proof = await uploadProof(db(), ctx.provider, ctx.shipmentId, { bytes: jpegBytes(), originalName: "p.jpg", purpose: "dispute" });
    await postDisputeMessage(db(), ctx.provider, d.id, { body: "Voici la photo à la remise", proofs: [{ fileId: proof.id }] });
    const updated = await postDisputeMessage(db(), operator, d.id, { body: "Merci, j'examine les éléments", proofs: [] });
    expect(updated.messages.map((m) => [m.authorRole, m.kind])).toEqual([
      ["sender", "opening"],
      ["provider", "message"],
      ["operator", "message"],
    ]);
    expect(updated.messages[1]!.proofs).toHaveLength(1);
    expect(await errorCode(postDisputeMessage(db(), await makeUser(), d.id, { body: "intrus", proofs: [] }))).toBe("not_found");
    expect(await errorCode(postDisputeMessage(db(), ctx.provider, d.id, { body: "x", proofs: [{ fileId: "00000000-0000-4000-8000-000000000000" }] }))).toBe("proof_not_found");
  });

  it("rend le fil immuable (trigger) et visible des seules parties", async () => {
    const ctx = await makeAcceptedShipment();
    const d = await dispute(ctx, ctx.sender);
    expect(await dbError(db().update(schema.disputeMessages).set({ body: "falsifié" }).where(eq(schema.disputeMessages.disputeId, d.id)))).toMatch(/ajout seul/);
    expect(await dbError(db().delete(schema.disputeMessages).where(eq(schema.disputeMessages.disputeId, d.id)))).toMatch(/ajout seul/);
    expect(await listShipmentDisputes(db(), ctx.provider, ctx.shipmentId)).toHaveLength(1);
    expect(await errorCode(listShipmentDisputes(db(), await makeUser(), ctx.shipmentId))).toBe("not_found");
  });

  it("liste les litiges ouverts aux seuls opérateurs", async () => {
    const ctx = await makeAcceptedShipment();
    await dispute(ctx, ctx.sender);
    expect(await errorCode(listOpenDisputes(db(), ctx.sender))).toBe("operator_required");
    const open = await listOpenDisputes(db(), await makeUser({ role: "operator" }));
    expect(open).toHaveLength(1);
    expect(open[0]!.trackingCode).toBe(ctx.trackingCode);
  });
});

describe("résolution par un opérateur", () => {
  it("est réservée aux opérateurs qui ne sont pas partie au colis", async () => {
    const ctx = await makeAcceptedShipment();
    const d = await dispute(ctx, ctx.sender);
    expect(await errorCode(resolve(d.id, ctx.sender, "returned"))).toBe("operator_required");
    expect(await errorCode(resolve(d.id, ctx.provider, "returned"))).toBe("operator_required");
    // un opérateur qui est aussi le transporteur ne peut pas juger son propre litige
    const both = await makeAcceptedShipment();
    await db().update(schema.users).set({ platformRole: "operator" }).where(eq(schema.users.id, both.provider.id));
    const d2 = await dispute(both, both.sender);
    expect(await errorCode(resolve(d2.id, { ...both.provider, platformRole: "operator" }, "delivered"))).toBe("party_cannot_resolve");
    expect(await errorCode(resolve("00000000-0000-4000-8000-000000000000", await makeUser({ role: "operator" }), "delivered"))).toBe("not_found");
  });

  it.each([
    ["delivered", "DELIVERED"],
    ["returned", "RETURNED"],
    ["lost", "LOST"],
    ["damaged", "DAMAGED"],
    ["cancelled", "CANCELLED"],
  ] as const)("issue « %s » : le colis passe à %s, le litige est clos et tracé", async (outcome, expected) => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator", name: "Opérateur Test" });
    await toArrived(ctx);
    const d = await dispute(ctx, ctx.sender);
    const done = await resolve(d.id, operator, outcome, "Décision motivée de l'opérateur");

    expect(done).toMatchObject({ status: "resolved", resolutionOutcome: outcome, resolutionNote: "Décision motivée de l'opérateur" });
    expect(done.resolvedAt).toBeInstanceOf(Date);
    expect(done.messages.at(-1)).toMatchObject({ kind: "resolution", authorRole: "operator", body: "Décision motivée de l'opérateur" });
    const view = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    expect(view.status).toBe(expected);
    expect(view.events.at(-1)).toMatchObject({ fromStatus: "DISPUTED", toStatus: expected, actorRole: "operator", note: "Décision motivée de l'opérateur" });
    const [row] = await db().select().from(schema.disputes).where(eq(schema.disputes.id, d.id));
    expect(row).toMatchObject({ status: "resolved", resolvedBy: operator.id });
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "dispute.resolved"));
    expect(logs[0]!.data).toMatchObject({ outcome, to: expected });
  });

  it("« resume » rend le colis à son état d'avant le litige, qui peut alors suivre son cours", async () => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    await move(ctx, ctx.provider, "HANDED_OVER");
    await move(ctx, ctx.provider, "IN_TRANSIT");
    const d = await dispute(ctx, ctx.sender, "Je n'ai aucune nouvelle du transporteur");
    await resolve(d.id, operator, "resume", "Litige infondé : le transporteur a répondu");
    expect((await getShipmentView(db(), ctx.provider, ctx.shipmentId)).status).toBe("IN_TRANSIT");
    await move(ctx, ctx.provider, "ARRIVED");
    expect((await getShipmentView(db(), ctx.provider, ctx.shipmentId)).status).toBe("ARRIVED");
    // et un nouveau litige reste possible
    await expect(dispute(ctx, ctx.sender, "Nouveau problème à l'arrivée du colis")).resolves.toMatchObject({ status: "open" });
  });

  it("« cancelled » libère la capacité et rouvre la demande", async () => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    const d = await dispute(ctx, ctx.sender, "Le transporteur ne répond plus, je veux annuler");
    await resolve(d.id, operator, "cancelled", "Annulation d'office");
    const [offer] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, ctx.offerId));
    expect(offer!.reservedWeightG).toBe(0);
    const [request] = await db().select().from(schema.shipmentRequests).where(eq(schema.shipmentRequests.id, ctx.requestId));
    expect(request!.status).toBe("open");
    await expect(requestBooking(db(), ctx.sender, { requestId: ctx.requestId, offerId: ctx.offerId })).resolves.toBeDefined();
  });

  it("ne se résout qu'une fois, même par deux opérateurs simultanés", async () => {
    const ctx = await makeAcceptedShipment();
    const [op1, op2] = await Promise.all([makeUser({ role: "operator" }), makeUser({ role: "operator" })]);
    const d = await dispute(ctx, ctx.sender);
    const results = await Promise.allSettled([resolve(d.id, op1, "returned"), resolve(d.id, op2, "delivered")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toMatch(/dispute_closed|invalid_transition|inconsistent_state/);
    expect(await errorCode(resolve(d.id, op1, "lost"))).toBe("dispute_closed");
    expect(await errorCode(postDisputeMessage(db(), ctx.sender, d.id, { body: "trop tard", proofs: [] }))).toBe("dispute_closed");
  });
});
