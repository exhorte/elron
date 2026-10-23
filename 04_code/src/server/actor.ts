import type { ActorRole } from "@/domain/workflow";

export type PlatformRole = "user" | "operator" | "admin";

/** Utilisateur authentifié tel que vu par les services. Ne contient jamais de secret. */
export interface Actor {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  isDemo: boolean;
}

export const isOperator = (actor: Actor): boolean => actor.platformRole === "operator" || actor.platformRole === "admin";

/**
 * Rôle de l'acteur sur un colis : partie (expéditeur/prestataire) d'abord, sinon opérateur, sinon aucun
 * accès (`null` → les services répondent 404 pour ne pas révéler l'existence du colis).
 */
export function resolveRole(actor: Actor, shipment: { senderUserId: string; providerUserId: string }): ActorRole | null {
  if (actor.id === shipment.senderUserId) return "sender";
  if (actor.id === shipment.providerUserId) return "provider";
  if (isOperator(actor)) return "operator";
  return null;
}
