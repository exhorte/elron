import type { AllowedContentType } from "@/config/uploads";

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/**
 * Détecte le type réel d'un fichier à partir de ses premiers octets (« magic bytes »). Retourne `null`
 * pour tout type non autorisé : HTML, SVG, exécutables, archives, etc. Un fichier qui commence comme une
 * image valide mais contient autre chose est servi avec le type détecté, `nosniff` et une CSP restrictive.
 */
export function sniffContentType(bytes: Uint8Array): AllowedContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WEBP : "RIFF" <taille sur 4 octets> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // "%PDF-"
  return null;
}

/** Nom affichable : sans chemin, sans caractères de contrôle, 100 caractères au plus. Jamais utilisé pour le stockage. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (cleaned || "fichier").slice(0, 100);
}
