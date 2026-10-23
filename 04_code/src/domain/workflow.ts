/**
 * Cycle de vie du colis (Shipment). Table déclarative = source unique de vérité.
 *
 * Réconciliation avec le prompt initial (DRAFT → REQUESTED → BOOKED → ACCEPTED → …) :
 *   DRAFT/REQUESTED  → états de la ShipmentRequest (open / booked / cancelled)
 *   BOOKED           → états de la Booking (requested → accepted)
 *   Le Shipment naît quand la réservation est acceptée : son premier état est donc ACCEPTED.
 * Voir DECISIONS_LOG D-006.
 */
export const SHIPMENT_STATUSES = [
  "ACCEPTED",
  "HANDED_OVER",
  "IN_TRANSIT",
  "ARRIVED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "DAMAGED",
  "LOST",
  "DISPUTED",
  "RETURNED",
  "CANCELLED",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** `system` = action sans acteur humain (non utilisé par l'API publique). */
export const ACTOR_ROLES = ["sender", "provider", "operator", "system"] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

type TransitionTable = Record<ShipmentStatus, Partial<Record<ShipmentStatus, readonly ActorRole[]>>>;

const PARTIES: readonly ActorRole[] = ["sender", "provider", "operator"];
const PROVIDER_OR_OP: readonly ActorRole[] = ["provider", "operator"];

export const TRANSITIONS: TransitionTable = {
  ACCEPTED: {
    HANDED_OVER: PROVIDER_OR_OP, // le prestataire déclare avoir pris le colis en charge
    CANCELLED: PARTIES,
    DISPUTED: PARTIES,
  },
  HANDED_OVER: {
    IN_TRANSIT: PROVIDER_OR_OP,
    DAMAGED: PROVIDER_OR_OP,
    LOST: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  IN_TRANSIT: {
    ARRIVED: PROVIDER_OR_OP,
    DAMAGED: PROVIDER_OR_OP,
    LOST: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  ARRIVED: {
    OUT_FOR_DELIVERY: PROVIDER_OR_OP,
    DELIVERED: ["provider"], // uniquement via confirmDelivery (code de remise) — voir shipments.ts
    DELIVERY_FAILED: PROVIDER_OR_OP,
    DAMAGED: PROVIDER_OR_OP,
    LOST: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  OUT_FOR_DELIVERY: {
    DELIVERED: ["provider"],
    DELIVERY_FAILED: PROVIDER_OR_OP,
    DAMAGED: PROVIDER_OR_OP,
    LOST: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  DELIVERY_FAILED: {
    OUT_FOR_DELIVERY: PROVIDER_OR_OP,
    DELIVERED: ["provider"],
    RETURNED: PROVIDER_OR_OP,
    DAMAGED: PROVIDER_OR_OP,
    LOST: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  DAMAGED: {
    RETURNED: PROVIDER_OR_OP,
    DISPUTED: PARTIES,
  },
  LOST: {
    DISPUTED: PARTIES,
  },
  DISPUTED: {
    // résolution : réservée à l'opérateur, et uniquement via `resolveDispute`
    DELIVERED: ["operator"],
    RETURNED: ["operator"],
    LOST: ["operator"],
    DAMAGED: ["operator"],
    CANCELLED: ["operator"],
    // litige rejeté : le colis reprend l'état d'avant (le service impose que ce soit exactement celui-là)
    ACCEPTED: ["operator"],
    HANDED_OVER: ["operator"],
    IN_TRANSIT: ["operator"],
    ARRIVED: ["operator"],
    OUT_FOR_DELIVERY: ["operator"],
    DELIVERY_FAILED: ["operator"],
  },
  DELIVERED: {
    DISPUTED: ["sender", "operator"],
  },
  RETURNED: {},
  CANCELLED: {},
};

/** États qui exigent une justification écrite (raison). */
export const NOTE_REQUIRED_FOR: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  "CANCELLED",
  "DELIVERY_FAILED",
  "DAMAGED",
  "LOST",
  "DISPUTED",
]);

/** États où le colis est physiquement sous la garde du prestataire. */
export const CUSTODY_STATUSES: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  "HANDED_OVER",
  "IN_TRANSIT",
  "ARRIVED",
  "OUT_FOR_DELIVERY",
  "DELIVERY_FAILED",
]);

export function isTerminal(status: ShipmentStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

export function canTransition(from: ShipmentStatus, to: ShipmentStatus, role: ActorRole): boolean {
  const roles = TRANSITIONS[from][to];
  return roles !== undefined && roles.includes(role);
}

export function isKnownTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from][to] !== undefined;
}

/** Cibles que `role` peut déclencher depuis `from`. */
export function allowedTargets(from: ShipmentStatus, role: ActorRole): ShipmentStatus[] {
  return (Object.keys(TRANSITIONS[from]) as ShipmentStatus[]).filter((to) => canTransition(from, to, role));
}

export const STATUS_LABELS_FR: Record<ShipmentStatus, string> = {
  ACCEPTED: "Réservation acceptée — en attente de remise",
  HANDED_OVER: "Colis remis au transporteur",
  IN_TRANSIT: "En transit",
  ARRIVED: "Arrivé à destination",
  OUT_FOR_DELIVERY: "En cours de remise au destinataire",
  DELIVERED: "Remis au destinataire",
  DELIVERY_FAILED: "Remise échouée",
  DAMAGED: "Endommagé",
  LOST: "Perdu",
  DISPUTED: "En litige",
  RETURNED: "Retourné à l'expéditeur",
  CANCELLED: "Annulé",
};
