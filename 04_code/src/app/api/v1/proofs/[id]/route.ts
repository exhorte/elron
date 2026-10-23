import { z } from "zod";
import { EXTENSIONS, type AllowedContentType } from "@/config/uploads";
import { requireActor, route } from "@/server/http";
import { readProof } from "@/server/proofs";

export const dynamic = "force-dynamic";

/**
 * Téléchargement d'une preuve : parties du colis et opérateurs uniquement. Le fichier est servi avec le type
 * détecté à l'envoi, `nosniff`, une CSP qui interdit tout script, sans cache partagé ; les images s'affichent
 * en ligne, les PDF sont téléchargés. Le nom de fichier de l'utilisateur n'est jamais renvoyé.
 */
export const GET = route<{ id: string }>({ auth: "user" }, async ({ db, actor, params }) => {
  const { contentType, bytes, id } = await readProof(db, requireActor(actor), z.uuid().parse(params.id));
  const isImage = contentType.startsWith("image/");
  const ext = EXTENSIONS[contentType as AllowedContentType] ?? "bin";
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${isImage ? "inline" : "attachment"}; filename="preuve-${id}.${ext}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
    },
  });
});
