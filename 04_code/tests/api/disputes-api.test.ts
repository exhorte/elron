import { beforeEach, describe, expect, it } from "vitest";
import { GET as adminDisputes } from "@/app/api/v1/admin/disputes/route";
import { POST as resolveRoute } from "@/app/api/v1/admin/disputes/[id]/resolve/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as messageRoute } from "@/app/api/v1/disputes/[id]/messages/route";
import { GET as disputesGet, POST as disputesPost } from "@/app/api/v1/shipments/[id]/disputes/route";
import { GET as shipmentGet } from "@/app/api/v1/shipments/[id]/route";
import { POST as transitionRoute } from "@/app/api/v1/shipments/[id]/transitions/route";
import { RATE_POLICIES } from "@/config/rate-limits";
import { makeAcceptedShipment, makeUser, resetDb } from "../helpers";
import { call, cookieFrom } from "./http-helpers";

beforeEach(resetDb);

const cookieFor = async (email: string) =>
  cookieFrom(await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email, password: "correct-horse-battery" } }));

async function setup() {
  const ctx = await makeAcceptedShipment();
  const operator = await makeUser({ role: "operator", email: "op-dispute@example.test" });
  return { ctx, sender: await cookieFor(ctx.sender.email), provider: await cookieFor(ctx.provider.email), operator: await cookieFor(operator.email) };
}

const open = (id: string, cookie: string | undefined, body: unknown) =>
  call(disputesPost, { method: "POST", path: `/api/v1/shipments/${id}/disputes`, cookie, params: { id }, body });

const VALID = { reasonCode: "not_received", description: "Le colis n'est jamais arrivé chez le destinataire" };

describe("API : litiges", () => {
  it("parcours complet : ouverture → messages → liste opérateur → résolution → colis mis à jour", async () => {
    const { ctx, sender, provider, operator } = await setup();
    const opened = await open(ctx.shipmentId, sender, VALID);
    expect(opened.status).toBe(201);
    const disputeId = opened.json.data.id as string;
    expect(opened.json.data).toMatchObject({ status: "open", reasonCode: "not_received", openerRole: "sender" });

    const shipment = await call(shipmentGet, { path: `/api/v1/shipments/${ctx.shipmentId}`, cookie: provider, params: { id: ctx.shipmentId } });
    expect(shipment.json.data).toMatchObject({ status: "DISPUTED", canOpenDispute: false, allowedTransitions: [] });
    expect(shipment.json.data.openDispute.id).toBe(disputeId);

    const msg = await call(messageRoute, { method: "POST", path: `/api/v1/disputes/${disputeId}/messages`, cookie: provider, params: { id: disputeId }, body: { body: "Je confirme avoir remis le colis" } });
    expect(msg.status).toBe(201);
    expect(msg.json.data.messages).toHaveLength(2);

    const list = await call(adminDisputes, { path: "/api/v1/admin/disputes", cookie: operator });
    expect(list.json.data.map((d: { id: string }) => d.id)).toEqual([disputeId]);

    const resolved = await call(resolveRoute, {
      method: "POST",
      path: `/api/v1/admin/disputes/${disputeId}/resolve`,
      cookie: operator,
      params: { id: disputeId },
      body: { outcome: "resume", note: "Preuves de remise fournies : on reprend" },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.json.data).toMatchObject({ status: "resolved", resolutionOutcome: "resume" });
    const after = await call(shipmentGet, { path: `/api/v1/shipments/${ctx.shipmentId}`, cookie: sender, params: { id: ctx.shipmentId } });
    expect(after.json.data.status).toBe("ACCEPTED");
    expect(after.json.data.openDispute).toBeNull();
  });

  it("exige une session, masque le colis aux tiers et réserve la résolution aux opérateurs", async () => {
    const { ctx, sender, provider } = await setup();
    expect((await open(ctx.shipmentId, undefined, VALID)).status).toBe(401);
    const stranger = await cookieFor((await makeUser({ email: "tiers@example.test" })).email);
    expect((await open(ctx.shipmentId, stranger, VALID)).status).toBe(404);
    expect((await call(disputesGet, { path: `/api/v1/shipments/${ctx.shipmentId}/disputes`, cookie: stranger, params: { id: ctx.shipmentId } })).status).toBe(404);

    const d = (await open(ctx.shipmentId, sender, VALID)).json.data.id as string;
    expect((await call(messageRoute, { method: "POST", path: `/api/v1/disputes/${d}/messages`, cookie: stranger, params: { id: d }, body: { body: "intrus" } })).status).toBe(404);
    for (const cookie of [sender, provider]) {
      const res = await call(resolveRoute, { method: "POST", path: `/api/v1/admin/disputes/${d}/resolve`, cookie, params: { id: d }, body: { outcome: "delivered", note: "je me donne raison" } });
      expect(res.status).toBe(403);
    }
    expect((await call(adminDisputes, { path: "/api/v1/admin/disputes", cookie: sender })).status).toBe(403);
  });

  it("valide les entrées : description trop courte, motif inconnu, champs inconnus, issue inconnue, note vide", async () => {
    const { ctx, sender, operator } = await setup();
    expect((await open(ctx.shipmentId, sender, { ...VALID, description: "court" })).status).toBe(422);
    expect((await open(ctx.shipmentId, sender, { ...VALID, reasonCode: "inventé" })).status).toBe(422);
    expect((await open(ctx.shipmentId, sender, { ...VALID, status: "resolved" })).status).toBe(422);
    const d = (await open(ctx.shipmentId, sender, VALID)).json.data.id as string;
    const resolve = (body: unknown) => call(resolveRoute, { method: "POST", path: `/api/v1/admin/disputes/${d}/resolve`, cookie: operator, params: { id: d }, body });
    expect((await resolve({ outcome: "gagné", note: "motif valable" })).status).toBe(422);
    expect((await resolve({ outcome: "returned", note: "" })).status).toBe(422);
    expect((await resolve({ outcome: "returned", note: "ok motif", extra: 1 })).status).toBe(422);
  });

  it("refuse l'ouverture d'un second litige (409) et les messages sur un litige clos (409)", async () => {
    const { ctx, sender, provider, operator } = await setup();
    const d = (await open(ctx.shipmentId, sender, VALID)).json.data.id as string;
    const second = await open(ctx.shipmentId, provider, VALID);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("dispute_open");
    await call(resolveRoute, { method: "POST", path: `/api/v1/admin/disputes/${d}/resolve`, cookie: operator, params: { id: d }, body: { outcome: "returned", note: "retour décidé" } });
    const late = await call(messageRoute, { method: "POST", path: `/api/v1/disputes/${d}/messages`, cookie: sender, params: { id: d }, body: { body: "trop tard" } });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("dispute_closed");
  });

  it("refuse DISPUTED par la route de transition générique (422) pour toutes les parties", async () => {
    const { ctx, sender } = await setup();
    const res = await call(transitionRoute, {
      method: "POST",
      path: `/api/v1/shipments/${ctx.shipmentId}/transitions`,
      cookie: sender,
      params: { id: ctx.shipmentId },
      body: { to: "DISPUTED", note: "contournement" },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("use_dispute_endpoint");
  });

  it("limite les ouvertures de litige par utilisateur (429)", async () => {
    const { ctx, sender } = await setup();
    for (let i = 0; i < RATE_POLICIES.disputeUser.limit; i += 1) expect((await open(ctx.shipmentId, sender, { reasonCode: "x" })).status).toBe(422);
    const blocked = await open(ctx.shipmentId, sender, VALID);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});
