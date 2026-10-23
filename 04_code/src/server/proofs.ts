import { createHash, randomUUID } from "node:crypto";
import { asc, count, eq, inArray } from "drizzle-orm";
import { PROOF_PURPOSE_LABELS, UPLOAD_LIMITS, type ProofPurpose } from "@/config/uploads";
import { schema, type Db, type DbOrTx } from "@/db/client";
import { sanitizeFileName, sniffContentType } from "@/domain/files";
import { resolveRole, type Actor } from "./actor";
import { audit } from "./audit";
import { AppError, conflict, invalid, notFound } from "./errors";
import { getStorage, type ObjectStorage } from "./storage";

const { proofFiles, shipments, users } = schema;

export interface ProofView {
  id: string;
  shipmentId: string;
  purpose: string;
  purposeLabel: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  originalName: string;
  uploaderRole: string;
  uploaderName: string;
  createdAt: Date;
}

/** Instantané figé dans l'événement de colis : la preuve citée reste vérifiable (empreinte) même plus tard. */
export interface ProofSnapshot {
  fileId: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  description: string | null;
}

export async function uploadProof(
  db: Db,
  actor: Actor,
  shipmentId: string,
  input: { bytes: Uint8Array; originalName: string; purpose: ProofPurpose },
  storage: ObjectStorage = getStorage(),
): Promise<ProofView> {
  const { bytes } = input;
  if (bytes.length === 0) throw invalid("file_empty", "Le fichier est vide");
  if (bytes.length > UPLOAD_LIMITS.maxBytes) {
    throw new AppError(413, "file_too_large", `Fichier trop volumineux (maximum ${UPLOAD_LIMITS.maxBytes / (1024 * 1024)} Mo)`);
  }
  const contentType = sniffContentType(bytes);
  if (!contentType) throw invalid("unsupported_file_type", "Type de fichier non accepté : JPEG, PNG, WEBP ou PDF uniquement");

  const [preview] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!preview) throw notFound("Colis");
  const role = resolveRole(actor, preview);
  if (!role) throw notFound("Colis");

  const storageKey = `${shipmentId}/${randomUUID()}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let stored = false;
  try {
    const row = await db.transaction(async (tx) => {
      // Le verrou sur le colis sérialise le comptage : deux envois simultanés ne dépassent pas la limite.
      await tx.select({ id: shipments.id }).from(shipments).where(eq(shipments.id, shipmentId)).for("update");
      const [{ n }] = (await tx.select({ n: count() }).from(proofFiles).where(eq(proofFiles.shipmentId, shipmentId))) as [{ n: number }];
      if (n >= UPLOAD_LIMITS.maxFilesPerShipment) {
        throw conflict("proof_limit_reached", `Maximum ${UPLOAD_LIMITS.maxFilesPerShipment} fichiers par colis`);
      }
      await storage.put(storageKey, bytes);
      stored = true;
      const [created] = await tx
        .insert(proofFiles)
        .values({
          shipmentId,
          uploadedBy: actor.id,
          uploaderRole: role,
          storageKey,
          originalName: sanitizeFileName(input.originalName),
          contentType,
          sizeBytes: bytes.length,
          sha256,
          purpose: input.purpose,
        })
        .returning();
      await audit(tx, {
        actorUserId: actor.id,
        action: "proof.uploaded",
        entityType: "shipment",
        entityId: shipmentId,
        data: { proofId: created!.id, purpose: input.purpose, sizeBytes: bytes.length, contentType },
      });
      return created!;
    });
    return toView(row, actor.displayName);
  } catch (err) {
    if (stored) await storage.remove(storageKey).catch(() => undefined); // pas de fichier orphelin
    throw err;
  }
}

function toView(row: typeof proofFiles.$inferSelect, uploaderName: string): ProofView {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    purpose: row.purpose,
    purposeLabel: PROOF_PURPOSE_LABELS[row.purpose as ProofPurpose] ?? row.purpose,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    originalName: row.originalName,
    uploaderRole: row.uploaderRole,
    uploaderName,
    createdAt: row.createdAt,
  };
}

export async function listProofs(db: Db, actor: Actor, shipmentId: string): Promise<ProofView[]> {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment || !resolveRole(actor, shipment)) throw notFound("Colis");
  const rows = await db
    .select({ proof: proofFiles, uploaderName: users.displayName })
    .from(proofFiles)
    .innerJoin(users, eq(users.id, proofFiles.uploadedBy))
    .where(eq(proofFiles.shipmentId, shipmentId))
    .orderBy(asc(proofFiles.createdAt));
  return rows.map((r) => toView(r.proof, r.uploaderName));
}

/** Lecture d'une preuve : parties du colis et opérateurs uniquement ; 404 pour tout autre (existence non révélée). */
export async function readProof(db: Db, actor: Actor, proofId: string, storage: ObjectStorage = getStorage()) {
  const [row] = await db
    .select({ proof: proofFiles, senderUserId: shipments.senderUserId, providerUserId: shipments.providerUserId })
    .from(proofFiles)
    .innerJoin(shipments, eq(shipments.id, proofFiles.shipmentId))
    .where(eq(proofFiles.id, proofId));
  if (!row || !resolveRole(actor, row)) throw notFound("Preuve");
  const bytes = await storage.get(row.proof.storageKey).catch(() => {
    throw notFound("Fichier");
  });
  return { contentType: row.proof.contentType, bytes, id: row.proof.id };
}

/**
 * Valide les preuves citées par une transition ou un litige : elles doivent appartenir à CE colis.
 * Retourne les instantanés (type, empreinte, taille) à figer dans l'événement.
 */
export async function resolveProofRefs(
  tx: DbOrTx,
  shipmentId: string,
  refs: Array<{ fileId: string; description?: string | null }>,
): Promise<ProofSnapshot[]> {
  if (refs.length === 0) return [];
  const ids = [...new Set(refs.map((r) => r.fileId))];
  const rows = await tx.select().from(proofFiles).where(inArray(proofFiles.id, ids));
  const byId = new Map(rows.filter((r) => r.shipmentId === shipmentId).map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw invalid("proof_not_found", "Preuve introuvable pour ce colis", { fileIds: missing });
  return refs.map((r) => {
    const row = byId.get(r.fileId)!;
    return { fileId: row.id, contentType: row.contentType, sha256: row.sha256, sizeBytes: row.sizeBytes, description: r.description ?? null };
  });
}
