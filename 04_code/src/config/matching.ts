import { z } from "zod";

/**
 * Pondérations du score de classement. HYPOTHÈSES INITIALES, non calibrées ni validées
 * scientifiquement (D-010). Elles n'affectent que le classement : les exigences obligatoires
 * (itinéraire, capacité, catégorie, dates, statut) sont des filtres d'exclusion, jamais des points.
 * Surcharge possible via la variable d'environnement ALX_MATCHING_WEIGHTS (JSON).
 */
export const CRITERIA = ["price", "dateProximity", "reliability", "delay", "headroom"] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface MatchingConfig {
  version: string;
  weights: Record<Criterion, number>;
  /** Au-delà de N jours d'écart avec la date souhaitée, le critère de proximité vaut 0. */
  dateProximityHorizonDays: number;
  /** Marge de capacité (en multiple du besoin) à partir de laquelle le critère vaut 1. */
  headroomCapRatio: number;
  /** Part des avis dans le critère de fiabilité (le reste vient du taux de livraisons réussies). Hypothèse non validée. */
  reliabilityRatingShare: number;
  /** Poids de l'a priori neutre (note 3/5) dans la moyenne bayésienne des avis : peu d'avis → proche du neutre. */
  ratingPriorWeight: number;
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  version: "2026-10-23-draft-2",
  weights: { price: 35, dateProximity: 20, reliability: 20, delay: 15, headroom: 10 },
  dateProximityHorizonDays: 14,
  headroomCapRatio: 1,
  reliabilityRatingShare: 0.4,
  ratingPriorWeight: 2,
};

const weightsSchema = z
  .object({
    price: z.number().min(0),
    dateProximity: z.number().min(0),
    reliability: z.number().min(0),
    delay: z.number().min(0),
    headroom: z.number().min(0),
  })
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) > 0, "La somme des pondérations doit être > 0");

export function loadMatchingConfig(env: NodeJS.ProcessEnv = process.env): MatchingConfig {
  const raw = env.ALX_MATCHING_WEIGHTS;
  if (!raw) return DEFAULT_MATCHING_CONFIG;
  const weights = weightsSchema.parse(JSON.parse(raw));
  return { ...DEFAULT_MATCHING_CONFIG, version: `${DEFAULT_MATCHING_CONFIG.version}+env`, weights };
}
