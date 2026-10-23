import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { UPLOAD_LIMITS } from "@/config/uploads";
import { listProofs, readProof, uploadProof } from "@/server/proofs";
import { LocalDiskStorage, type ObjectStorage } from "@/server/storage";
import { getShipmentView, transitionShipment } from "@/server/shipments";
import { db, dbError, errorCode, jpegBytes, makeAcceptedShipment, makeUser, pdfBytes, resetDb } from "../helpers";

beforeEach(resetDb);

const uploadDir = () => process.env.UPLOAD_DIR!;
const filesOf = async (shipmentId: string) => readdir(path.join(uploadDir(), shipmentId)).catch(() => [] as string[]);

type Ctx = Awaited<ReturnType<typeof makeAcceptedShipment>>;
const upload = (ctx: Ctx, actor: Ctx["sender"], bytes = jpegBytes(), name = "photo.jpg", purpose: "handover" | "damage" | "other" = "handover") =>
  uploadProof(db(), actor, ctx.shipmentId, { bytes, originalName: name, purpose });

describe("téléversement d'une preuve", () => {
  it("enregistre le fichier sur le stockage privé avec type détecté et empreinte SHA-256", async () => {
    const ctx = await makeAcceptedShipment();
    const bytes = jpegBytes(4096, 0x42);
    const proof = await upload(ctx, ctx.provider, bytes, "../../remise finale.JPG");
    expect(proof).toMatchObject({ contentType: "image/jpeg", sizeBytes: 4096, uploaderRole: "provider", purpose: "handover", originalName: "remise finale.JPG" });
    expect(proof.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    const [row] = await db().select().from(schema.proofFiles).where(eq(schema.proofFiles.id, proof.id));
    expect(row!.storageKey).toMatch(new RegExp(`^${ctx.shipmentId}/[0-9a-f-]{36}$`));
    const stored = await new LocalDiskStorage(uploadDir()).get(row!.storageKey);
    expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
    expect(await filesOf(ctx.shipmentId)).toHaveLength(1);
  });

  it("déduit le type des octets : l'extension et le nom ne comptent pas", async () => {
    const ctx = await makeAcceptedShipment();
    const pdf = await upload(ctx, ctx.sender, pdfBytes(), "image.png");
    expect(pdf.contentType).toBe("application/pdf");
    const jpg = await upload(ctx, ctx.sender, jpegBytes(), "document.pdf");
    expect(jpg.contentType).toBe("image/jpeg");
  });

  it("accepte l'expéditeur, le transporteur et l'opérateur, mais pas un tiers", async () => {
    const ctx = await makeAcceptedShipment();
    const operator = await makeUser({ role: "operator" });
    for (const actor of [ctx.sender, ctx.provider, operator]) await upload(ctx, actor);
    expect((await listProofs(db(), ctx.sender, ctx.shipmentId)).map((p) => p.uploaderRole).sort()).toEqual(["operator", "provider", "sender"]);
    const stranger = await makeUser();
    expect(await errorCode(upload(ctx, stranger))).toBe("not_found");
    expect(await errorCode(listProofs(db(), stranger, ctx.shipmentId))).toBe("not_found");
    expect(await filesOf(ctx.shipmentId)).toHaveLength(3);
  });

  it("refuse les fichiers vides, trop gros et les types non autorisés (HTML, SVG, exécutable)", async () => {
    const ctx = await makeAcceptedShipment();
    expect(await errorCode(upload(ctx, ctx.sender, new Uint8Array(0)))).toBe("file_empty");
    expect(await errorCode(upload(ctx, ctx.sender, jpegBytes(UPLOAD_LIMITS.maxBytes + 1)))).toBe("file_too_large");
    for (const [name, content] of [
      ["faux.jpg", "<html><script>alert(1)</script></html>"],
      ["logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      ["setup.jpg", "MZ\x90\x00 programme"],
      ["note.png", "texte brut"],
    ] as const) {
      expect(await errorCode(upload(ctx, ctx.sender, new TextEncoder().encode(content), name)), name).toBe("unsupported_file_type");
    }
    expect(await filesOf(ctx.shipmentId)).toHaveLength(0);
    expect(await db().select().from(schema.proofFiles)).toHaveLength(0);
  });

  it("accepte exactement la taille maximale", async () => {
    const ctx = await makeAcceptedShipment();
    await expect(upload(ctx, ctx.sender, jpegBytes(UPLOAD_LIMITS.maxBytes))).resolves.toBeDefined();
  });

  it("plafonne le nombre de fichiers par colis, même sous envois simultanés, sans fichier orphelin", async () => {
    const ctx = await makeAcceptedShipment();
    const results = await Promise.allSettled(Array.from({ length: UPLOAD_LIMITS.maxFilesPerShipment + 5 }, (_, i) => upload(ctx, ctx.sender, jpegBytes(512, 0x30 + (i % 10)))));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(UPLOAD_LIMITS.maxFilesPerShipment);
    for (const r of results) if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("proof_limit_reached");
    expect(await db().select().from(schema.proofFiles)).toHaveLength(UPLOAD_LIMITS.maxFilesPerShipment);
    expect(await filesOf(ctx.shipmentId)).toHaveLength(UPLOAD_LIMITS.maxFilesPerShipment);
  });

  it("ne laisse aucune ligne en base si le stockage échoue", async () => {
    const ctx = await makeAcceptedShipment();
    const broken: ObjectStorage = {
      name: "broken",
      put: async () => {
        throw new Error("disque plein");
      },
      get: async () => new Uint8Array(),
      remove: async () => undefined,
    };
    await expect(uploadProof(db(), ctx.sender, ctx.shipmentId, { bytes: jpegBytes(), originalName: "a.jpg", purpose: "other" }, broken)).rejects.toThrow("disque plein");
    expect(await db().select().from(schema.proofFiles)).toHaveLength(0);
  });

  it("journalise l'envoi sans contenu et sans chemin de stockage", async () => {
    const ctx = await makeAcceptedShipment();
    const proof = await upload(ctx, ctx.sender);
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "proof.uploaded"));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data).toMatchObject({ proofId: proof.id, contentType: "image/jpeg", sizeBytes: 2048 });
    expect(JSON.stringify(logs)).not.toMatch(/storage|\/[0-9a-f]{8}-/);
  });

  it("est immuable : la base refuse de modifier ou de supprimer une preuve", async () => {
    const ctx = await makeAcceptedShipment();
    const proof = await upload(ctx, ctx.sender);
    expect(await dbError(db().update(schema.proofFiles).set({ sha256: "x" }).where(eq(schema.proofFiles.id, proof.id)))).toMatch(/ajout seul/);
    expect(await dbError(db().delete(schema.proofFiles).where(eq(schema.proofFiles.id, proof.id)))).toMatch(/ajout seul/);
  });

  it("refuse en base un type de contenu hors liste", async () => {
    const ctx = await makeAcceptedShipment();
    const proof = await upload(ctx, ctx.sender);
    const [row] = await db().select().from(schema.proofFiles).where(eq(schema.proofFiles.id, proof.id));
    const { id: _id, ...clone } = row!;
    void _id;
    expect(await dbError(db().insert(schema.proofFiles).values({ ...clone, storageKey: `${ctx.shipmentId}/${crypto.randomUUID()}`, contentType: "image/svg+xml" }))).toMatch(/proof_files_content_type_allowed/);
  });
});

describe("lecture d'une preuve", () => {
  it("rend les octets exacts aux parties et aux opérateurs, 404 aux autres", async () => {
    const ctx = await makeAcceptedShipment();
    const bytes = jpegBytes(1500, 0x55);
    const proof = await upload(ctx, ctx.sender, bytes);
    const operator = await makeUser({ role: "operator" });
    for (const actor of [ctx.sender, ctx.provider, operator]) {
      const read = await readProof(db(), actor, proof.id);
      expect(read.contentType).toBe("image/jpeg");
      expect(Buffer.from(read.bytes).equals(Buffer.from(bytes))).toBe(true);
    }
    expect(await errorCode(readProof(db(), await makeUser(), proof.id))).toBe("not_found");
    expect(await errorCode(readProof(db(), ctx.sender, "00000000-0000-4000-8000-000000000000"))).toBe("not_found");
  });

  it("ne révèle jamais le chemin de stockage dans les métadonnées", async () => {
    const ctx = await makeAcceptedShipment();
    await upload(ctx, ctx.sender);
    const json = JSON.stringify(await listProofs(db(), ctx.provider, ctx.shipmentId));
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain(uploadDir());
  });
});

describe("preuves rattachées à un changement de statut", () => {
  it("fige dans l'événement le type, la taille et l'empreinte de chaque fichier cité", async () => {
    const ctx = await makeAcceptedShipment();
    const proof = await upload(ctx, ctx.provider, jpegBytes(900, 0x61));
    await transitionShipment(db(), ctx.provider, ctx.shipmentId, { to: "HANDED_OVER", note: "Colis pesé", proofs: [{ fileId: proof.id, description: "Colis scellé" }] });
    const view = await getShipmentView(db(), ctx.sender, ctx.shipmentId);
    expect(view.events.at(-1)!.proofs).toEqual([{ fileId: proof.id, contentType: "image/jpeg", sha256: proof.sha256, sizeBytes: 900, description: "Colis scellé" }]);
  });

  it("refuse une preuve inconnue ou appartenant à un autre colis, sans changer le statut", async () => {
    const ctx = await makeAcceptedShipment();
    const other = await makeAcceptedShipment();
    const foreign = await upload(other, other.sender);
    for (const fileId of [foreign.id, "00000000-0000-4000-8000-000000000000"]) {
      expect(await errorCode(transitionShipment(db(), ctx.provider, ctx.shipmentId, { to: "HANDED_OVER", note: null, proofs: [{ fileId }] }))).toBe("proof_not_found");
    }
    expect((await getShipmentView(db(), ctx.provider, ctx.shipmentId)).status).toBe("ACCEPTED");
  });
});
