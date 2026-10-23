import { beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { GET as proofGet } from "@/app/api/v1/proofs/[id]/route";
import { GET as proofsList, POST as proofsPost } from "@/app/api/v1/shipments/[id]/proofs/route";
import { POST as transitionRoute } from "@/app/api/v1/shipments/[id]/transitions/route";
import { GET as shipmentGet } from "@/app/api/v1/shipments/[id]/route";
import { RATE_POLICIES } from "@/config/rate-limits";
import { UPLOAD_LIMITS } from "@/config/uploads";
import { jpegBytes, makeAcceptedShipment, makeUser, pdfBytes, resetDb } from "../helpers";
import { call, cookieFrom } from "./http-helpers";

beforeEach(resetDb);

const PASSWORD = "correct-horse-battery";
async function cookieFor(email: string) {
  return cookieFrom(await call(loginRoute, { method: "POST", path: "/api/v1/auth/login", body: { email, password: PASSWORD } }));
}

function form(bytes: Uint8Array, name = "preuve.jpg", purpose?: string) {
  const f = new FormData();
  f.append("file", new File([bytes as BlobPart], name));
  if (purpose) f.append("purpose", purpose);
  return f;
}

async function setup() {
  const ctx = await makeAcceptedShipment();
  return { ctx, sender: await cookieFor(ctx.sender.email), provider: await cookieFor(ctx.provider.email) };
}

const upload = (id: string, cookie: string | undefined, f: FormData) =>
  call(proofsPost, { method: "POST", path: `/api/v1/shipments/${id}/proofs`, cookie, params: { id }, form: f });

describe("API : téléversement et téléchargement de preuves", () => {
  it("téléverse (201), sans jamais exposer le chemin de stockage, puis restitue les octets exacts avec des en-têtes durcis", async () => {
    const { ctx, sender, provider } = await setup();
    const bytes = jpegBytes(3000, 0x7a);
    const res = await upload(ctx.shipmentId, provider, form(bytes, "remise.jpg", "handover"));
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ contentType: "image/jpeg", sizeBytes: 3000, purpose: "handover", uploaderRole: "provider" });
    expect(res.text).not.toMatch(/storage|alx-test-uploads/i);

    const id = res.json.data.id as string;
    const dl = await call(proofGet, { path: `/api/v1/proofs/${id}`, cookie: sender, params: { id } });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(dl.headers.get("content-type")).toBe("image/jpeg");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(dl.headers.get("cache-control")).toBe("private, no-store");
    expect(dl.headers.get("content-disposition")).toBe(`inline; filename="preuve-${id}.jpg"`);
  });

  it("sert les PDF en téléchargement (attachment), sans reprendre le nom fourni par l'utilisateur", async () => {
    const { ctx, sender } = await setup();
    const res = await upload(ctx.shipmentId, sender, form(pdfBytes(), "<script>alert(1)</script>.pdf"));
    expect(res.status).toBe(201);
    const id = res.json.data.id as string;
    const dl = await call(proofGet, { path: `/api/v1/proofs/${id}`, cookie: sender, params: { id } });
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="preuve-${id}.pdf"`);
    expect(dl.headers.get("content-disposition")).not.toContain("script");
  });

  it("exige une session et refuse les tiers (404, existence non révélée)", async () => {
    const { ctx, sender } = await setup();
    const res = await upload(ctx.shipmentId, sender, form(jpegBytes()));
    const id = res.json.data.id as string;
    expect((await upload(ctx.shipmentId, undefined, form(jpegBytes()))).status).toBe(401);
    expect((await call(proofGet, { path: `/api/v1/proofs/${id}`, params: { id } })).status).toBe(401);
    const stranger = await makeUser({ email: "intrus@example.test" });
    const strangerCookie = await cookieFor(stranger.email);
    expect((await call(proofGet, { path: `/api/v1/proofs/${id}`, cookie: strangerCookie, params: { id } })).status).toBe(404);
    expect((await upload(ctx.shipmentId, strangerCookie, form(jpegBytes()))).status).toBe(404);
    expect((await call(proofsList, { path: `/api/v1/shipments/${ctx.shipmentId}/proofs`, cookie: strangerCookie, params: { id: ctx.shipmentId } })).status).toBe(404);
  });

  it("valide le contenu : type détecté, taille, champ manquant, finalité", async () => {
    const { ctx, sender } = await setup();
    const html = await upload(ctx.shipmentId, sender, form(new TextEncoder().encode("<html><script>1</script></html>"), "x.jpg"));
    expect(html.status).toBe(422);
    expect(html.json.error.code).toBe("unsupported_file_type");

    const big = await upload(ctx.shipmentId, sender, form(jpegBytes(UPLOAD_LIMITS.maxBytes + 10)));
    expect(big.status).toBe(413);

    const noFile = new FormData();
    noFile.append("purpose", "other");
    expect((await upload(ctx.shipmentId, sender, noFile)).json.error.code).toBe("file_required");

    expect((await upload(ctx.shipmentId, sender, form(jpegBytes(), "a.jpg", "pas-une-finalite"))).status).toBe(422);
    expect((await upload(ctx.shipmentId, sender, form(new Uint8Array(0)))).json.error.code).toBe("file_empty");
  });

  it("refuse un mauvais Content-Type (415) et plafonne la lecture d'un flux géant sans Content-Length (413)", async () => {
    const { ctx, sender } = await setup();
    const json = await call(proofsPost, { method: "POST", path: `/api/v1/shipments/${ctx.shipmentId}/proofs`, cookie: sender, params: { id: ctx.shipmentId }, body: { file: "x" } });
    expect(json.status).toBe(415);

    const total = UPLOAD_LIMITS.maxBytes + UPLOAD_LIMITS.multipartOverheadBytes;
    const streamed = await call(proofsPost, {
      method: "POST",
      path: `/api/v1/shipments/${ctx.shipmentId}/proofs`,
      cookie: sender,
      params: { id: ctx.shipmentId },
      stream: { chunks: 12, chunkBytes: Math.ceil(total / 4), contentType: "multipart/form-data; boundary=x" },
    });
    expect(streamed.status).toBe(413);
    expect(streamed.json.error.code).toBe("payload_too_large");

    const malformed = await call(proofsPost, { method: "POST", path: `/api/v1/shipments/${ctx.shipmentId}/proofs`, cookie: sender, params: { id: ctx.shipmentId }, rawBody: "pas du multipart", contentType: "multipart/form-data; boundary=zzz" });
    expect(malformed.status).toBe(400);
  });

  it("limite le nombre d'envois par utilisateur (429)", async () => {
    const { ctx, sender } = await setup();
    const empty = new FormData();
    for (let i = 0; i < RATE_POLICIES.uploadUser.limit; i += 1) expect((await upload(ctx.shipmentId, sender, empty)).status).toBe(422);
    const blocked = await upload(ctx.shipmentId, sender, empty);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });

  it("rattache une preuve téléversée à une transition, visible dans l'historique du colis", async () => {
    const { ctx, provider, sender } = await setup();
    const up = await upload(ctx.shipmentId, provider, form(jpegBytes(1234), "prise.jpg", "handover"));
    const fileId = up.json.data.id as string;
    const step = await call(transitionRoute, {
      method: "POST",
      path: `/api/v1/shipments/${ctx.shipmentId}/transitions`,
      cookie: provider,
      params: { id: ctx.shipmentId },
      body: { to: "HANDED_OVER", note: "Colis scellé", proofs: [{ fileId, description: "Scellé intact" }] },
    });
    expect(step.status).toBe(200);
    const view = await call(shipmentGet, { path: `/api/v1/shipments/${ctx.shipmentId}`, cookie: sender, params: { id: ctx.shipmentId } });
    expect(view.json.data.events.at(-1).proofs).toMatchObject([{ fileId, contentType: "image/jpeg", description: "Scellé intact" }]);

    const bad = await call(transitionRoute, {
      method: "POST",
      path: `/api/v1/shipments/${ctx.shipmentId}/transitions`,
      cookie: provider,
      params: { id: ctx.shipmentId },
      body: { to: "IN_TRANSIT", proofs: [{ fileId: "00000000-0000-4000-8000-000000000000" }] },
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("proof_not_found");
    const old = await call(transitionRoute, {
      method: "POST",
      path: `/api/v1/shipments/${ctx.shipmentId}/transitions`,
      cookie: provider,
      params: { id: ctx.shipmentId },
      body: { to: "IN_TRANSIT", proofs: [{ type: "photo", reference: "x.jpg" }] },
    });
    expect(old.status).toBe(422); // l'ancien format « référence libre » n'existe plus
  });
});
