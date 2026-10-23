import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { HANDOVER_CONFIG } from "@/domain/handover";
import { requestBooking } from "@/server/bookings";
import {
  confirmDelivery,
  generateShipmentDeliveryCode,
  getShipmentView,
  listMyShipments,
  trackPublic,
  transitionShipment,
} from "@/server/shipments";
import type { TransitionInput } from "@/server/validation";
import { uploadProof } from "@/server/proofs";
import { DAY, db, dbError, errorCode, jpegBytes, makeAcceptedShipment, makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

type Ctx = Awaited<ReturnType<typeof makeAcceptedShipment>>;
const move = (ctx: Ctx, actor: Ctx["provider"], to: TransitionInput["to"], note?: string) =>
  transitionShipment(db(), actor, ctx.shipmentId, { to, note: note ?? null, proofs: [] });

async function toArrived(ctx: Ctx) {
  await move(ctx, ctx.provider, "HANDED_OVER");
  await move(ctx, ctx.provider, "IN_TRANSIT");
  await move(ctx, ctx.provider, "ARRIVED");
}

describe("cycle de vie nominal", () => {
  it("suit ACCEPTED → … → DELIVERED avec un événement par étape (acteur, rôle, statuts, date)", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    await move(ctx, ctx.provider, "OUT_FOR_DELIVERY");
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);

    const view = await getShipmentView(db(), ctx.provider, ctx.shipmentId);
    expect(view.status).toBe("DELIVERED");
    expect(view.events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "ACCEPTED"],
      ["ACCEPTED", "HANDED_OVER"],
      ["HANDED_OVER", "IN_TRANSIT"],
      ["IN_TRANSIT", "ARRIVED"],
      ["ARRIVED", "OUT_FOR_DELIVERY"],
      ["OUT_FOR_DELIVERY", "DELIVERED"],
    ]);
    for (const e of view.events) {
      expect(e.actorRole).toBe("provider");
      expect(e.actorName).toBe("Moussa Transporteur");
      expect(e.occurredAt).toBeInstanceOf(Date);
    }
    expect(view.allowedTransitions).toEqual([]); // le transporteur ne peut plus rien faire (seuls expéditeur/opérateur peuvent contester)
    const delivered = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.toStatus, "DELIVERED"));
    expect(delivered[0]!.context).toMatchObject({ via: "delivery_code" });
  });

  it("permet la livraison directe depuis ARRIVED (parcours sans étape de remise séparée)", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("DELIVERED");
  });

  it("gère un échec de remise puis une nouvelle tentative", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    expect(await errorCode(move(ctx, ctx.provider, "DELIVERY_FAILED"))).toBe("note_required");
    await move(ctx, ctx.provider, "DELIVERY_FAILED", "Destinataire absent");
    await move(ctx, ctx.provider, "OUT_FOR_DELIVERY");
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);
    expect((await getShipmentView(db(), ctx.provider, ctx.shipmentId)).status).toBe("DELIVERED");
  });

  it("enregistre les justifications et les preuves téléversées (détail dans proofs.test.ts)", async () => {
    const ctx = await makeAcceptedShipment();
    const proof = await uploadProof(db(), ctx.provider, ctx.shipmentId, { bytes: jpegBytes(), originalName: "remise.jpg", purpose: "handover" });
    await transitionShipment(db(), ctx.provider, ctx.shipmentId, {
      to: "HANDED_OVER",
      note: "Colis pesé : 5,1 kg",
      proofs: [{ fileId: proof.id, description: "Colis scellé" }],
    });
    const view = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    const event = view.events.at(-1)!;
    expect(event.note).toBe("Colis pesé : 5,1 kg");
    expect(event.proofs).toMatchObject([{ fileId: proof.id, sha256: proof.sha256, description: "Colis scellé" }]);
  });
});

describe("contrôle des transitions et des rôles", () => {
  it("refuse les transitions arbitraires (409)", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(move(ctx, ctx.provider, "DELIVERED"))).toBe("invalid_transition");
    expect(await errorCode(move(ctx, ctx.provider, "IN_TRANSIT"))).toBe("invalid_transition");
    expect(await errorCode(move(ctx, ctx.provider, "ACCEPTED"))).toBe("invalid_transition");
    await move(ctx, ctx.provider, "HANDED_OVER");
    expect(await errorCode(move(ctx, ctx.provider, "HANDED_OVER"))).toBe("invalid_transition");
    expect(await errorCode(move(ctx, ctx.provider, "ARRIVED"))).toBe("invalid_transition");
  });

  it("refuse un rôle non autorisé (403) : l'expéditeur ne déclare pas la prise en charge", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(move(ctx, ctx.sender, "HANDED_OVER"))).toBe("transition_forbidden");
    await toArrived(ctx);
    expect(await errorCode(move(ctx, ctx.sender, "OUT_FOR_DELIVERY"))).toBe("transition_forbidden");
  });

  it("masque le colis aux tiers (404) et l'ouvre aux opérateurs", async () => {
    const ctx = await makeAcceptedShipment();
    const stranger = await makeUser();
    const operator = await makeUser({ role: "operator" });
    expect(await errorCode(getShipmentView(db(), stranger, ctx.shipmentId))).toBe("not_found");
    expect(await errorCode(move(ctx, stranger, "HANDED_OVER"))).toBe("not_found");
    expect((await getShipmentView(db(), operator, ctx.shipmentId)).viewerRole).toBe("operator");
    await move(ctx, operator, "HANDED_OVER");
    const view = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    expect(view.events.at(-1)).toMatchObject({ actorRole: "operator" });
  });

  it("interdit la livraison par la route générique (le code est obligatoire)", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    expect(await errorCode(move(ctx, ctx.provider, "DELIVERED"))).toBe("delivery_code_required");
    expect(await errorCode(move(ctx, ctx.sender, "DELIVERED"))).toBe("transition_forbidden");
  });

  it("exige une justification pour les états d'exception", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.provider, "HANDED_OVER");
    expect(await errorCode(move(ctx, ctx.provider, "DAMAGED"))).toBe("note_required");
    expect(await errorCode(move(ctx, ctx.provider, "LOST", "   "))).toBe("note_required");
    await move(ctx, ctx.provider, "DAMAGED", "Emballage déchiré dans le bus");
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("DAMAGED");
  });

  it("journalise les transitions sensibles dans l'audit", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.provider, "HANDED_OVER");
    await move(ctx, ctx.provider, "LOST", "Bagage perdu à l'escale");
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "shipment.transition"));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data).toMatchObject({ from: "HANDED_OVER", to: "LOST", role: "provider" });
  });

  it("sérialise deux transitions simultanées : une seule réussit", async () => {
    const ctx = await makeAcceptedShipment();
    const results = await Promise.allSettled([move(ctx, ctx.provider, "HANDED_OVER"), move(ctx, ctx.provider, "HANDED_OVER")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toBe("invalid_transition");
    const events = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.toStatus, "HANDED_OVER"));
    expect(events).toHaveLength(1);
  });
});

describe("annulation et litiges", () => {
  it("l'annulation avant remise libère la capacité, annule la réservation et rouvre la demande", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(move(ctx, ctx.sender, "CANCELLED"))).toBe("note_required");
    await move(ctx, ctx.sender, "CANCELLED", "Changement de plan");

    const [offer] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, ctx.offerId));
    expect(offer!.reservedWeightG).toBe(0);
    const [booking] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, ctx.bookingId));
    expect(booking!.status).toBe("cancelled");
    const [request] = await db().select().from(schema.shipmentRequests).where(eq(schema.shipmentRequests.id, ctx.requestId));
    expect(request!.status).toBe("open");

    // La capacité est de nouveau réservable, et la demande peut être re-réservée.
    const again = await requestBooking(db(), ctx.sender, { requestId: ctx.requestId, offerId: ctx.offerId });
    expect(again.status).toBe("requested");
    expect(await errorCode(move(ctx, ctx.provider, "HANDED_OVER"))).toBe("invalid_transition");
  });

  it("le transporteur peut aussi annuler avant remise ; plus après", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.provider, "HANDED_OVER");
    expect(await errorCode(move(ctx, ctx.provider, "CANCELLED", "Raison"))).toBe("invalid_transition");
    const ctx2 = await makeAcceptedShipment();
    await move(ctx2, ctx2.provider, "CANCELLED", "Voyage annulé");
    expect((await getShipmentView(db(), ctx2.sender, ctx2.shipmentId)).status).toBe("CANCELLED");
  });

  it("deux annulations simultanées ne libèrent la capacité qu'une fois", async () => {
    const ctx = await makeAcceptedShipment();
    const results = await Promise.allSettled([move(ctx, ctx.sender, "CANCELLED", "a"), move(ctx, ctx.provider, "CANCELLED", "b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [offer] = await db().select().from(schema.capacityOffers).where(eq(schema.capacityOffers.id, ctx.offerId));
    expect(offer!.reservedWeightG).toBe(0);
  });

  it("les litiges ne passent plus par la transition générique (voir disputes.test.ts)", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    expect(await errorCode(move(ctx, ctx.sender, "DISPUTED", "Le colis ne correspond pas à la description"))).toBe("use_dispute_endpoint");
    expect(await errorCode(move(ctx, ctx.provider, "DISPUTED", "x"))).toBe("use_dispute_endpoint");
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("ARRIVED");
  });
});

describe("code de remise", () => {
  it("n'est jamais stocké en clair, ni visible du transporteur, ni journalisé", async () => {
    const ctx = await makeAcceptedShipment();
    const { code, generation, expiresAt } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    expect(code).toMatch(/^\d{6}$/);
    expect(generation).toBe(1);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + (HANDOVER_CONFIG.ttlDays - 1) * DAY);

    const [row] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, ctx.shipmentId));
    expect(row!.deliveryCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(`"${code}"`);

    const providerView = JSON.stringify(await getShipmentView(db(), ctx.provider, ctx.shipmentId));
    const senderView = JSON.stringify(await getShipmentView(db(), ctx.sender, ctx.shipmentId));
    expect(providerView).not.toContain(code);
    expect(senderView).not.toContain(code); // relecture impossible : affiché une seule fois à la génération

    const audits = JSON.stringify(await db().select().from(schema.auditLogs));
    expect(audits).not.toContain(code);
    const events = JSON.stringify(await db().select().from(schema.shipmentEvents));
    expect(events).not.toContain(code);
  });

  it("n'est générable que par l'expéditeur", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(generateShipmentDeliveryCode(db(), ctx.provider, ctx.shipmentId))).toBe("forbidden");
    expect(await errorCode(generateShipmentDeliveryCode(db(), await makeUser(), ctx.shipmentId))).toBe("not_found");
    expect(await errorCode(generateShipmentDeliveryCode(db(), await makeUser({ role: "admin" }), ctx.shipmentId))).toBe("forbidden");
  });

  it("n'est confirmable que par le transporteur, une fois le colis arrivé et le code généré", async () => {
    const ctx = await makeAcceptedShipment();
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    expect(await errorCode(confirmDelivery(db(), ctx.sender, ctx.shipmentId, code))).toBe("only_provider_confirms");
    expect(await errorCode(confirmDelivery(db(), await makeUser({ role: "operator" }), ctx.shipmentId, code))).toBe("only_provider_confirms");
    expect(await errorCode(confirmDelivery(db(), await makeUser(), ctx.shipmentId, code))).toBe("not_found");
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code))).toBe("not_deliverable");

    const ctx2 = await makeAcceptedShipment();
    await toArrived(ctx2);
    expect(await errorCode(confirmDelivery(db(), ctx2.provider, ctx2.shipmentId, "123456"))).toBe("delivery_code_not_generated");
  });

  it("est à usage unique", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, code);
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code))).toBe("not_deliverable");
    expect(await errorCode(generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId))).toBe("delivery_code_not_available");
    const [row] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, ctx.shipmentId));
    expect(row!.deliveryCodeConsumedAt).not.toBeNull();
  });

  it("compte les tentatives, se verrouille après 5 échecs même avec le bon code, se débloque par régénération", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 1; i < HANDOVER_CONFIG.maxAttempts; i += 1) {
      try {
        await confirmDelivery(db(), ctx.provider, ctx.shipmentId, wrong);
        expect.unreachable();
      } catch (err) {
        const e = err as { code: string; details: { attemptsLeft: number } };
        expect(e.code).toBe("delivery_code_invalid");
        expect(e.details.attemptsLeft).toBe(HANDOVER_CONFIG.maxAttempts - i);
      }
    }
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, wrong))).toBe("delivery_code_locked");
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code))).toBe("delivery_code_locked");
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("ARRIVED");
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).deliveryCode.locked).toBe(true);

    const second = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    expect(second.generation).toBe(2);
    const view = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    expect(view.deliveryCode.locked).toBe(false);
    expect(view.deliveryCode.attemptsLeft).toBe(HANDOVER_CONFIG.maxAttempts);
    if (second.code !== code) expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code))).toBe("delivery_code_invalid");
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, second.code);
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("DELIVERED");
  });

  it("applique la limite de tentatives même sous requêtes parallèles", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    const wrong = code === "000000" ? "000001" : "000000";
    const results = await Promise.allSettled(Array.from({ length: 9 }, () => confirmDelivery(db(), ctx.provider, ctx.shipmentId, wrong)));
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code: string }).code : "ok"));
    expect(codes.filter((c) => c === "delivery_code_invalid")).toHaveLength(HANDOVER_CONFIG.maxAttempts - 1);
    expect(codes.filter((c) => c === "delivery_code_locked")).toHaveLength(9 - (HANDOVER_CONFIG.maxAttempts - 1));
    const [row] = await db().select().from(schema.shipments).where(eq(schema.shipments.id, ctx.shipmentId));
    expect(row!.deliveryCodeAttempts).toBe(HANDOVER_CONFIG.maxAttempts);
  });

  it("expire après le délai configuré ; une régénération redonne un code valable", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    const t0 = new Date();
    const { code } = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId, t0);
    const late = new Date(t0.getTime() + (HANDOVER_CONFIG.ttlDays + 1) * DAY);
    expect(await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, code, late))).toBe("delivery_code_expired");
    const fresh = await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId, late);
    await confirmDelivery(db(), ctx.provider, ctx.shipmentId, fresh.code, late);
    expect((await getShipmentView(db(), ctx.sender, ctx.shipmentId)).status).toBe("DELIVERED");
  });

  it("limite le nombre de régénérations par colis", async () => {
    const ctx = await makeAcceptedShipment();
    for (let i = 0; i < 5; i += 1) await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    expect(await errorCode(generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId))).toBe("delivery_code_generation_limit");
  });

  it("ne permet pas de générer un code pour un colis annulé", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.sender, "CANCELLED", "raison");
    expect(await errorCode(generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId))).toBe("delivery_code_not_available");
  });

  it("journalise les tentatives sans jamais écrire le code saisi", async () => {
    const ctx = await makeAcceptedShipment();
    await toArrived(ctx);
    await generateShipmentDeliveryCode(db(), ctx.sender, ctx.shipmentId);
    await errorCode(confirmDelivery(db(), ctx.provider, ctx.shipmentId, "654321"));
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "delivery_code.failed_attempt"));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(logs)).not.toContain("654321");
    expect(logs[0]!.data).toMatchObject({ attempts: 1, locked: false });
  });
});

describe("journaux immuables", () => {
  it("la base refuse de modifier ou supprimer un événement de colis", async () => {
    const ctx = await makeAcceptedShipment();
    await move(ctx, ctx.provider, "HANDED_OVER");
    expect(await dbError(db().execute(sql`UPDATE shipment_events SET note = 'falsifié' WHERE shipment_id = ${ctx.shipmentId}`))).toMatch(/ajout seul/);
    expect(await dbError(db().execute(sql`DELETE FROM shipment_events WHERE shipment_id = ${ctx.shipmentId}`))).toMatch(/ajout seul/);
    const events = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, ctx.shipmentId));
    expect(events).toHaveLength(2);
  });

  it("la base refuse de modifier ou supprimer le journal d'audit", async () => {
    await makeAcceptedShipment();
    expect(await dbError(db().execute(sql`UPDATE audit_logs SET action = 'x'`))).toMatch(/ajout seul/);
    expect(await dbError(db().execute(sql`DELETE FROM audit_logs`))).toMatch(/ajout seul/);
    expect((await db().select().from(schema.auditLogs)).length).toBeGreaterThan(0);
  });
});

describe("suivi public et listes", () => {
  it("expose un suivi public sans aucune donnée personnelle", async () => {
    const ctx = await makeAcceptedShipment();
    await transitionShipment(db(), ctx.provider, ctx.shipmentId, { to: "HANDED_OVER", note: "Remis à Moussa, tel +221770000000", proofs: [] });
    const lower = await trackPublic(db(), ctx.trackingCode.toLowerCase());
    expect(lower.status).toBe("HANDED_OVER");
    expect(lower.origin).toBe("Dakar");
    expect(lower.destination).toBe("Abidjan");
    expect(lower.events.map((e) => e.status)).toEqual(["ACCEPTED", "HANDED_OVER"]);
    const raw = JSON.stringify(lower);
    for (const secret of ["Moussa", "Fatou", "Awa", "+2250700", "+221770000000", "Vêtements", "Remis à"]) expect(raw).not.toContain(secret);
  });

  it("répond 404 pour un code inconnu ou mal formé", async () => {
    expect(await errorCode(trackPublic(db(), "ALX-ZZZZZZZZ"))).toBe("not_found");
    expect(await errorCode(trackPublic(db(), "n'importe quoi"))).toBe("not_found");
    expect(await errorCode(trackPublic(db(), "' OR 1=1 --"))).toBe("not_found");
  });

  it("liste les colis de l'utilisateur dans chacun de ses rôles", async () => {
    const ctx = await makeAcceptedShipment();
    const both = await listMyShipments(db(), ctx.sender);
    expect(both).toHaveLength(1);
    expect(both[0]!.viewerRole).toBe("sender");
    expect((await listMyShipments(db(), ctx.provider))[0]!.viewerRole).toBe("provider");
    expect(await listMyShipments(db(), await makeUser())).toHaveLength(0);
  });

  it("révèle les adresses et le destinataire aux seules parties, pas le code de remise", async () => {
    const ctx = await makeAcceptedShipment();
    const view = await getShipmentView(db(), ctx.provider, ctx.shipmentId);
    expect(view.receiver).toEqual({ name: "Awa Koné", phone: "+22507000000" });
    expect(view.offer.depositAddress).toBe("Point de dépôt de test");
    expect(view.price).toEqual({ subtotalMinor: 17_500, currency: "XOF" });
    expect(view.deliveryCode).toMatchObject({ generated: false, canGenerate: false });
    const senderView = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    expect(senderView.deliveryCode.canGenerate).toBe(true);
  });
});
