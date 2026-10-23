/** Limites des preuves téléversées (D-022). Valeurs de départ, ajustables. */
export const UPLOAD_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  /** Marge pour l'enveloppe multipart (en-têtes de champs) au-delà de la taille maximale du fichier. */
  multipartOverheadBytes: 64 * 1024,
  maxFilesPerShipment: 20,
} as const;

/** Seuls ces types sont acceptés ; le type est déduit des octets, jamais de l'en-tête ni de l'extension. SVG et HTML sont exclus (scripts). */
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const PROOF_PURPOSES = ["handover", "delivery", "damage", "dispute", "other"] as const;
export type ProofPurpose = (typeof PROOF_PURPOSES)[number];

export const PROOF_PURPOSE_LABELS: Record<ProofPurpose, string> = {
  handover: "Prise en charge",
  delivery: "Remise",
  damage: "Dommage",
  dispute: "Litige",
  other: "Autre",
};

export const EXTENSIONS: Record<AllowedContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
