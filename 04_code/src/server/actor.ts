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
