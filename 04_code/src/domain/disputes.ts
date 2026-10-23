/** Motifs et issues de litige : valeurs pures, partagées par la base, la validation, l'API et l'interface. */
export const DISPUTE_REASONS = ["not_received", "damaged_goods", "content_mismatch", "delay", "lost", "conduct", "other"] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/** `resume` = litige rejeté, le colis reprend l'état d'avant ; les autres appliquent un statut final au colis. */
export const DISPUTE_OUTCOMES = ["resume", "delivered", "returned", "lost", "damaged", "cancelled"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];
