import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Code de remise : 6 chiffres, à usage unique, expirant, limité en tentatives.
 * Seul un HMAC (clé serveur + identifiant du colis) est stocké ; le code en clair n'est
 * montré qu'une fois à l'expéditeur. Un code à 6 chiffres reste faible face à une attaque
 * hors-ligne : la limite de tentatives côté serveur et le secret (pepper) sont indispensables.
 */
export const HANDOVER_CONFIG = {
  codeLength: 6,
  maxAttempts: 5,
  ttlDays: 30,
} as const;

export function generateDeliveryCode(): string {
  return String(randomInt(0, 10 ** HANDOVER_CONFIG.codeLength)).padStart(HANDOVER_CONFIG.codeLength, "0");
}

export function hashDeliveryCode(code: string, shipmentId: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`${shipmentId}:${code}`).digest("hex");
}

export function verifyDeliveryCode(code: string, shipmentId: string, pepper: string, expectedHash: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const actual = Buffer.from(hashDeliveryCode(code, shipmentId, pepper), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function deliveryCodeExpiry(from: Date): Date {
  return new Date(from.getTime() + HANDOVER_CONFIG.ttlDays * 24 * 60 * 60 * 1000);
}

export type CodeCheck = "ok" | "locked" | "expired" | "consumed";

/** État du code avant comparaison : détermine si une tentative est encore autorisée. */
export function checkCodeState(
  state: { attempts: number; lockedAt: Date | null; expiresAt: Date; consumedAt: Date | null },
  now: Date,
): CodeCheck {
  if (state.consumedAt) return "consumed";
  if (state.lockedAt || state.attempts >= HANDOVER_CONFIG.maxAttempts) return "locked";
  if (state.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}
