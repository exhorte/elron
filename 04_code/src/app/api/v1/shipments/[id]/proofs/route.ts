import { z } from "zod";
import { RATE_POLICIES } from "@/config/rate-limits";
import { UPLOAD_LIMITS } from "@/config/uploads";
import { HttpResult, requireActor, route } from "@/server/http";
import { listProofs, uploadProof } from "@/server/proofs";
import { enforceRateLimit } from "@/server/rate-limit";
import { proofUploadFieldsSchema } from "@/server/validation";
import { invalid } from "@/server/errors";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) =>
  listProofs(db, requireActor(actor), z.uuid().parse(params.id)),
);

/** multipart/form-data : `file` (JPEG, PNG, WEBP ou PDF ≤ 5 Mo) et `purpose`. Le type est déduit des octets. */
export const POST = route<{ id: string }>({ auth: "user", mutation: true }, async ({ db, actor, params, formData, now }) => {
  const user = requireActor(actor);
  const shipmentId = z.uuid().parse(params.id);
  await enforceRateLimit(db, RATE_POLICIES.uploadUser, user.id, now);
  const form = await formData(UPLOAD_LIMITS.maxBytes + UPLOAD_LIMITS.multipartOverheadBytes);
  const file = form.get("file");
  if (!(file instanceof File)) throw invalid("file_required", "Champ « file » manquant");
  const { purpose } = proofUploadFieldsSchema.parse({ ...(form.get("purpose") ? { purpose: String(form.get("purpose")) } : {}) });
  const proof = await uploadProof(db, user, shipmentId, { bytes: new Uint8Array(await file.arrayBuffer()), originalName: file.name, purpose });
  return new HttpResult(proof, 201);
});
